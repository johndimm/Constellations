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
    await client.query("create unique index if not exists nodes_title_type_wiki_idx on nodes (lower(title), type, wikipedia_id)");
    console.log("Schema migrations applied (image_url, wiki_summary, wikipedia_id defaults, unique index).");
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
create unique index if not exists nodes_title_type_wiki_idx on nodes (lower(title), type, wikipedia_id);
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

      // 1. Check for existing node (case-insensitive on title+type only, ignore wikipedia_id)
      // Prefer nodes with wikipedia_id (more complete), then oldest
      const checkSql = `
            select id from nodes 
            where lower(title) = lower($1) and type = $2
            order by 
              case when wikipedia_id is not null and wikipedia_id != '' then 0 else 1 end,
              id
            limit 1
        `;
      const checkRes = await client.query(checkSql, [title, n.type]);

      let id;

      if (checkRes.rows.length > 0) {
        // 2. UPDATE existing
        id = checkRes.rows[0].id;
        const updateSql = `
                update nodes set
                  description = coalesce($1, description),
                  year = coalesce($2, year),
                  meta = coalesce(meta, '{}'::jsonb) || coalesce($3, '{}'::jsonb),
                  image_url = coalesce($4, image_url),
                  wiki_summary = coalesce($5, wiki_summary),
                  updated_at = now()
                where id = $6
             `;
        await client.query(updateSql, [
          n.description ?? null,
          n.year ?? null,
          meta,
          imageUrl,
          wikiSummary,
          id
        ]);
      } else {
        // 3. INSERT new
        const insertSql = `
               insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary)
               values ($1, $2, $3, $4, $5, $6, $7, $8)
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
          return { ...r, meta: mergedMeta, imageUrl: r.image_url, wikiSummary: r.wiki_summary };
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

    // 1. Get source node type to know if it's a person or event
    const sourceRes = await client.query("select type from nodes where id = $1", [sourceId]);
    if (sourceRes.rowCount === 0) throw new Error("Source node not found");
    const sourceType = sourceRes.rows[0].type;

    // 2. Upsert target nodes
    const idMap = await upsertNodes(client, nodes);

    // 3. Create edges
    for (const [key, targetId] of idMap.entries()) {
      const [title, type, wikiId] = key.split("|");

      let personId, eventId;
      if (sourceType === 'Person') {
        personId = sourceId;
        eventId = targetId;
      } else {
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
