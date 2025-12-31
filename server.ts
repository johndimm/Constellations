import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pg from "pg";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Load env from .env.local if present
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")];
const dotenv = await import("dotenv");
envPaths.forEach(p => {
  if (fs.existsSync(p)) {
    console.log(`Loading env from: ${p}`);
    dotenv.config({ path: p });
  }
});

const { Pool } = pg;

if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  console.warn("Warning: DATABASE_URL is not set. Pool will try local defaults (likely to fail).");
}
// Explicitly allow self-signed certs when SSL is enabled (common on hosted Postgres).
// Force SSL unless PGSSLMODE=disable. We also set environment-level override in case the driver
// reads from env instead of the config object.
const useSsl = process.env.PGSSLMODE !== "disable";
if (useSsl && !process.env.PGSSLMODE) {
  process.env.PGSSLMODE = "require";
}
const sslConfig = useSsl ? { rejectUnauthorized: false } : undefined;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: sslConfig
});

console.log(`Connecting to database: ${process.env.PGDATABASE || (process.env.DATABASE_URL ? "URL provided" : "default")}`);

// Ensure schema exists on startup (safe to run repeatedly).
async function ensureSchema() {
  console.log("Checking schema...");
  let client;
  try {
    client = await pool.connect();
    // Always ensure tables exist
    await client.query(initSql);

    // Apply lightweight migrations in place (no data loss)
    await client.query("alter table if exists nodes add column if not exists image_url text");
    await client.query("alter table if exists nodes add column if not exists wiki_summary text");
    await client.query("alter table if exists nodes alter column wikipedia_id set default ''");
    await client.query("update nodes set wikipedia_id = '' where wikipedia_id is null");
    await client.query("alter table if exists nodes alter column wikipedia_id set not null");
    // Enforce case-insensitive uniqueness across title and type to avoid duplicates like "Gaslight" vs "gaslight" or "Movie" vs "movie"
    await client.query("drop index if exists nodes_title_type_wiki_idx");
    await client.query("create unique index if not exists nodes_title_ltype_wiki_idx on nodes (lower(title), lower(type), wikipedia_id)");
    await client.query("create unique index if not exists nodes_title_ltype_blank_wiki_uidx on nodes (lower(title), lower(type)) where (wikipedia_id is null or wikipedia_id = '')");
    
    // Add is_person column for app logic (boolean), preserving original type
    await client.query("alter table if exists nodes add column if not exists is_person boolean");
    await client.query("update nodes set is_person = (lower(type) = 'person') where is_person is null");
    await client.query("create index if not exists nodes_is_person_idx on nodes(is_person)");
    
    console.log("Schema migrations applied (image_url, wiki_summary, wikipedia_id defaults, unique index, is_person).");
  } catch (e) {
    console.error("Schema init failed", e);
  } finally {
    if (client) client.release();
  }
}
ensureSchema();

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(bodyParser.json());

// Schema initializer
const initSql = `
create table if not exists nodes (
  id serial primary key,
  title text not null,
  type text not null,
  is_person boolean,
  wikipedia_id text not null default '',
  description text,
  year int,
  image_url text,
  wiki_summary text,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(title, type, wikipedia_id)
);

create table if not exists edges (
  id serial primary key,
  person_id int not null references nodes(id) on delete cascade,
  event_id int not null references nodes(id) on delete cascade,
  label text,
  updated_at timestamptz default now(),
  unique(person_id, event_id)
);

create index if not exists edges_person_idx on edges (person_id);
create index if not exists edges_event_idx on edges (event_id);
create unique index if not exists nodes_title_ltype_wiki_idx on nodes (lower(title), lower(type), wikipedia_id);
`;

// Upsert nodes batch and return mapping of (title, type, wikipedia_id) -> id
async function upsertNodes(client: pg.PoolClient, nodes: any[]): Promise<Map<string, number>> {
  if (!nodes.length) return new Map();

  const idMap = new Map<string, number>();

  for (const n of nodes) {
    const meta = n.meta || {};
    const wikiId = (n.wikipedia_id || n.wikipediaId || "").toString().trim();
    const normalizedWikiId = wikiId || "";
    const imageUrl = meta.imageUrl || n.imageUrl || n.image_url || null;
    const wikiSummary = meta.wikiSummary || n.wikiSummary || n.wiki_summary || null;
    // Manual Check-then-Insert/Update Strategy to handle case-insensitive uniqueness reliably
    try {
      const title = n.title || n.id;

      // 1. Strongest match: any node with the same wikipedia_id (independent of title/type)
      const wikiRes = normalizedWikiId
        ? await client.query(
          `select id, type, wikipedia_id from nodes where COALESCE(wikipedia_id, '') = $1 limit 1`,
          [normalizedWikiId]
        )
        : { rows: [] as any[] };

      // 2. Prefer exact wiki_id + title/type (backwards compatibility)
      const exactRes = (normalizedWikiId && wikiRes.rows.length === 0)
        ? await client.query(
          `
            select id, type, wikipedia_id from nodes
            where lower(title) = lower($1) and lower(type) = lower($2) and COALESCE(wikipedia_id, '') = $3
            order by id
            limit 1
          `,
          [title, n.type, normalizedWikiId]
        )
        : { rows: [] as any[] };

      // 3. Fallback: any node with same lower(title)/lower(type), prefer one that already has a wiki_id
      const fuzzyRes = (wikiRes.rows.length === 0 && exactRes.rows.length === 0)
        ? await client.query(
          `
            select id, type, wikipedia_id from nodes
            where lower(title) = lower($1) and lower(type) = lower($2)
            order by 
              case when wikipedia_id is not null and wikipedia_id != '' then 0 else 1 end,
              id
            limit 1
          `,
          [title, n.type]
        )
        : { rows: [] as any[] };

      let id;
      const matchRow = wikiRes.rows[0] || exactRes.rows[0] || fuzzyRes.rows[0];

      if (matchRow) {
        // 2. UPDATE existing node (duplicate found)
        id = matchRow.id;
        const existingType = matchRow.type;
        const existingWiki = matchRow.wikipedia_id || '';
        // Prefer the more specific type (capitalized like "Movie" over lowercase like "event")
        const typeToKeep = (existingType && existingType !== existingType.toLowerCase()) ? existingType : n.type;
        const wikiToKeep = existingWiki || normalizedWikiId || '';
        const updateSql = `
                update nodes set
                  type = $1,
                  description = coalesce($2, description),
                  year = coalesce($3, year),
                  meta = coalesce(meta, '{}'::jsonb) || coalesce($4, '{}'::jsonb),
                  image_url = coalesce($5, image_url),
                  wiki_summary = coalesce($6, wiki_summary),
                  wikipedia_id = $8,
                  is_person = (lower($1) = 'person'),
                  updated_at = now()
                where id = $7
             `;
        await client.query(updateSql, [
          typeToKeep,
          n.description ?? null,
          n.year ?? null,
          meta,
          imageUrl,
          wikiSummary,
          id,
          wikiToKeep
        ]);
      } else {
        // 3. INSERT new
        const insertSql = `
               insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary, is_person)
               values ($1, $2, $3, $4, $5, $6, $7, $8, lower($2) = 'person')
               returning id
             `;
        const insertRes = await client.query(insertSql, [
          title,
          n.type,
          n.description ?? null,
          n.year ?? null,
          meta,
          normalizedWikiId,
          imageUrl,
          wikiSummary
        ]);
        id = insertRes.rows[0].id;
      }

      const key = `${title}|${n.type}|${n.wikipedia_id || ''}`;
      idMap.set(key, id);
    } catch (e: any) {
      console.error("Upsert failed for node", n.title, e.message);
      // Continue best effort or re-throw? 
      // Logic suggests usually we want to proceed with other nodes if one fails, but explicit errors are helpful.
      // For now, re-throwing might block the entire batch, but it's consistent with previous behavior.
      throw e;
    }
  }

  return idMap;
}

async function upsertEdge(client: pg.PoolClient, personId: number, eventId: number, label?: string) {
  await client.query(
    `
      insert into edges (person_id, event_id, label)
      values ($1, $2, $3)
      on conflict (person_id, event_id) do update
      set label = coalesce(excluded.label, edges.label), updated_at = now();
    `,
    [personId, eventId, label || null]
  );
}

// Routes
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/init", async (_, res) => {
  const client = await pool.connect();
  try {
    await client.query("drop table if exists edges cascade");
    await client.query("drop table if exists nodes cascade");
    await client.query(initSql);
    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Find path between two nodes using database (BFS)
app.get("/path", async (req, res) => {
  const { startId, endId, maxDepth = "10" } = req.query as { startId?: string; endId?: string; maxDepth?: string };
  if (!startId || !endId) return res.status(400).json({ error: "startId and endId required" });

  const start = parseInt(startId);
  const end = parseInt(endId);
  const maxD = parseInt(maxDepth || "10");
  if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: "startId and endId must be numbers" });

  const client = await pool.connect();
  try {
    // BFS to find path between two nodes
    // Graph is bipartite: Person <-> Event <-> Person <-> Event...
    const visited = new Set<number>();
    const queue: Array<{ nodeId: number; path: number[] }> = [{ nodeId: start, path: [start] }];
    visited.add(start);

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      
      if (path.length > maxD) continue; // Skip paths that exceed max depth

      // Get node type to know if we need person or event neighbors
      const nodeRes = await client.query("select is_person from nodes where id = $1", [nodeId]);
      if (nodeRes.rows.length === 0) continue;
      const isPerson = nodeRes.rows[0].is_person ?? false;

      // Get neighbors: if current node is person, get events; if event, get people
      const neighborsRes = await client.query(
        isPerson
          ? `select event_id as neighbor_id from edges where person_id = $1`
          : `select person_id as neighbor_id from edges where event_id = $1`,
        [nodeId]
      );

      for (const row of neighborsRes.rows) {
        const neighborId = row.neighbor_id;
        
        if (neighborId === end) {
          // Found path!
          const fullPath = [...path, neighborId];
          // Fetch all nodes in the path using parameterized query
          const nodesRes = await client.query(
            `select * from nodes where id = ANY($1::int[])`,
            [fullPath]
          );
          const nodeMap = new Map(nodesRes.rows.map(r => [r.id, r]));
          
          const pathNodes = fullPath.map(id => {
            const node = nodeMap.get(id);
            if (!node) return null;
            const m = node.meta || {};
            const mergedMeta = { ...m };
            if (!mergedMeta.imageUrl && node.image_url) mergedMeta.imageUrl = node.image_url;
            if (!mergedMeta.wikiSummary && node.wiki_summary) mergedMeta.wikiSummary = node.wiki_summary;
            return {
              ...node,
              meta: mergedMeta,
              imageUrl: node.image_url,
              wikiSummary: node.wiki_summary,
              is_person: node.is_person ?? (node.type?.toLowerCase() === 'person')
            };
          }).filter((n): n is NonNullable<typeof n> => n !== null);

          return res.json({ path: pathNodes, found: true });
        }

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ nodeId: neighborId, path: [...path, neighborId] });
        }
      }
    }

    // No path found
    return res.json({ path: [], found: false });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Fetch expansion: return all neighbors of a node
app.get("/expansion", async (req, res) => {
  const { sourceId } = req.query as { sourceId?: string };
  if (!sourceId) return res.status(400).json({ error: "sourceId required" });

  const id = parseInt(sourceId);
  if (isNaN(id)) return res.status(400).json({ error: "sourceId must be a number" });

  const client = await pool.connect();
  try {
    // Fetch all nodes connected to this node
    const result = await client.query(
      `
      select n.* from nodes n
      join edges e on (e.person_id = n.id or e.event_id = n.id)
      where (e.person_id = $1 or e.event_id = $1) and n.id != $1
      `,
      [id]
    );

    if (result.rowCount && result.rowCount > 0) {
      return res.json({
        hit: "exact",
        targets: result.rows.map(r => r.id),
        nodes: result.rows.map(r => {
          const m = r.meta || {};
          const mergedMeta = { ...m };
          if (!mergedMeta.imageUrl && r.image_url) mergedMeta.imageUrl = r.image_url;
          if (!mergedMeta.wikiSummary && r.wiki_summary) mergedMeta.wikiSummary = r.wiki_summary;
          return { ...r, meta: mergedMeta, imageUrl: r.image_url, wikiSummary: r.wiki_summary, is_person: r.is_person ?? (r.type?.toLowerCase() === 'person') };
        })
      });
    }

    return res.json({ hit: "miss" });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Save expansion
app.post("/expansion", async (req, res) => {
  const { sourceId, nodes } = req.body as {
    sourceId: number;
    nodes: any[];      // nodes to upsert
  };

  if (!sourceId || !nodes) return res.status(400).json({ error: "sourceId and nodes required" });

  const client = await pool.connect();
  try {
    await client.query("begin");

    // 1. Get source node is_person to know if it's a person or event
    const sourceRes = await client.query("select is_person, type from nodes where id = $1", [sourceId]);
    if (sourceRes.rowCount === 0) throw new Error("Source node not found");
    const sourceIsPerson = sourceRes.rows[0].is_person ?? (sourceRes.rows[0].type?.toLowerCase() === 'person');

    // 2. Upsert target nodes
    const idMap = await upsertNodes(client, nodes);

    // 3. Create edges
    for (const [key, targetId] of idMap.entries()) {
      const [title, type, wikiId] = key.split("|");

      let personId, eventId;
      if (sourceIsPerson) {
        // Source is a person, so source -> target is person -> event
        personId = sourceId;
        eventId = targetId;
      } else {
        // Source is an event, so target -> source is person -> event
        personId = targetId;
        eventId = sourceId;
      }

      await upsertEdge(client, personId, eventId);
    }

    await client.query("commit");
    res.json({ ok: true });
  } catch (e: any) {
    await client.query("rollback");
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Upsert a single node
app.post("/node", async (req, res) => {
  const node = req.body as { title?: string; type?: string; description?: string | null; year?: number | null; meta?: any; wikipedia_id?: string };
  if (!node.title && !(node as any).id) return res.status(400).json({ error: "title required" });
  if (!node.type) return res.status(400).json({ error: "type required" });

  const client = await pool.connect();
  try {
    const idMap = await upsertNodes(client, [{
      title: node.title || (node as any).id,
      type: node.type,
      description: node.description ?? null,
      year: node.year ?? null,
      meta: node.meta ?? {},
      wikipedia_id: node.wikipedia_id ?? null
    }]);

    const id = Array.from(idMap.values())[0];
    res.json({ ok: true, id });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Cache server listening on ${port}`);
});
