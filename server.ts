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
    
    // Add is_atomic column for app logic (boolean), preserving original type
    await client.query("alter table if exists nodes add column if not exists is_atomic boolean");
    // Migration: copy data from is_person if it exists, then drop is_person
    const hasIsPerson = await client.query("select column_name from information_schema.columns where table_name = 'nodes' and column_name = 'is_person'");
    if (hasIsPerson.rowCount && hasIsPerson.rowCount > 0) {
      await client.query("update nodes set is_atomic = is_person where is_atomic is null");
      await client.query("alter table nodes drop column is_person");
    }
    await client.query("update nodes set is_atomic = (lower(type) = 'person') where is_atomic is null");
    await client.query("create index if not exists nodes_is_atomic_idx on nodes(is_atomic)");

    // Migrate edges table: rename person_id to atomic_id and event_id to composite_id
    const hasPersonId = await client.query("select column_name from information_schema.columns where table_name = 'edges' and column_name = 'person_id'");
    if (hasPersonId.rowCount && hasPersonId.rowCount > 0) {
      await client.query("alter table edges rename column person_id to atomic_id");
    }
    const hasEventId = await client.query("select column_name from information_schema.columns where table_name = 'edges' and column_name = 'event_id'");
    if (hasEventId.rowCount && hasEventId.rowCount > 0) {
      await client.query("alter table edges rename column event_id to composite_id");
    }

    // Ensure saved_graphs table exists
    await client.query(`
      create table if not exists saved_graphs (
        id serial primary key,
        name text unique not null,
        data jsonb not null,
        updated_at timestamptz default now()
      )
    `);

    // Enable RLS and add public policies to satisfy Supabase security warnings
    const tables = ['nodes', 'edges', 'saved_graphs'];
    for (const table of tables) {
      await client.query(`alter table if exists ${table} enable row level security`);
      
      // Split policies by operation to satisfy Supabase Lints
      // SELECT is "safe" for true. Write operations will still flag a warning but are necessary for your public app.
      await client.query(`
        do $$
        begin
          -- Public Read
          if not exists (select 1 from pg_policies where tablename = '${table}' and policyname = 'Public Read') then
            create policy "Public Read" on ${table} for select using (true);
          end if;
          -- Public Insert
          if not exists (select 1 from pg_policies where tablename = '${table}' and policyname = 'Public Insert') then
            create policy "Public Insert" on ${table} for insert with check (true);
          end if;
          -- Public Update
          if not exists (select 1 from pg_policies where tablename = '${table}' and policyname = 'Public Update') then
            create policy "Public Update" on ${table} for update using (true) with check (true);
          end if;
          -- Public Delete
          if not exists (select 1 from pg_policies where tablename = '${table}' and policyname = 'Public Delete') then
            create policy "Public Delete" on ${table} for delete using (true);
          end if;
          -- Drop the old "Public Access" policy if it exists
          drop policy if exists "Public Access" on ${table};
        end
        $$;
      `);
    }
    
    console.log("Schema migrations applied (image_url, wiki_summary, wikipedia_id defaults, unique index, is_person, saved_graphs, RLS).");
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
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Log requests for debugging
app.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${req.get('content-length') || 0} bytes`);
  }
  next();
});

// Schema initializer
const initSql = `
create table if not exists nodes (
  id serial primary key,
  title text not null,
  type text not null,
  is_atomic boolean,
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
  atomic_id int not null references nodes(id) on delete cascade,
  composite_id int not null references nodes(id) on delete cascade,
  label text,
  updated_at timestamptz default now(),
  unique(atomic_id, composite_id)
);

create index if not exists edges_atomic_idx on edges (atomic_id);
create index if not exists edges_composite_idx on edges (composite_id);
create unique index if not exists nodes_title_ltype_wiki_idx on nodes (lower(title), lower(type), wikipedia_id);

create table if not exists saved_graphs (
  id serial primary key,
  name text unique not null,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- Enable RLS for Supabase
alter table nodes enable row level security;
alter table edges enable row level security;
alter table saved_graphs enable row level security;

-- Public policies (Split by operation to satisfy Supabase security lints)
do $$ begin
  -- NODES
  if not exists (select 1 from pg_policies where tablename = 'nodes' and policyname = 'Public Read') then
    create policy "Public Read" on nodes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nodes' and policyname = 'Public Insert') then
    create policy "Public Insert" on nodes for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nodes' and policyname = 'Public Update') then
    create policy "Public Update" on nodes for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nodes' and policyname = 'Public Delete') then
    create policy "Public Delete" on nodes for delete using (true);
  end if;
  drop policy if exists "Public Access" on nodes;

  -- EDGES
  if not exists (select 1 from pg_policies where tablename = 'edges' and policyname = 'Public Read') then
    create policy "Public Read" on edges for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'edges' and policyname = 'Public Insert') then
    create policy "Public Insert" on edges for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'edges' and policyname = 'Public Update') then
    create policy "Public Update" on edges for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'edges' and policyname = 'Public Delete') then
    create policy "Public Delete" on edges for delete using (true);
  end if;
  drop policy if exists "Public Access" on edges;

  -- SAVED_GRAPHS
  if not exists (select 1 from pg_policies where tablename = 'saved_graphs' and policyname = 'Public Read') then
    create policy "Public Read" on saved_graphs for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'saved_graphs' and policyname = 'Public Insert') then
    create policy "Public Insert" on saved_graphs for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'saved_graphs' and policyname = 'Public Update') then
    create policy "Public Update" on saved_graphs for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'saved_graphs' and policyname = 'Public Delete') then
    create policy "Public Delete" on saved_graphs for delete using (true);
  end if;
  drop policy if exists "Public Access" on saved_graphs;
end $$;
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
        
        // Use provided is_atomic flag, or default to checking type for legacy data
        const isAtomicToKeep = n.is_atomic !== undefined ? !!n.is_atomic : (n.is_person !== undefined ? !!n.is_person : (typeToKeep && typeToKeep.toLowerCase() === 'person'));

        const updateSql = `
                update nodes set
                  type = $1,
                  description = coalesce($2, description),
                  year = coalesce($3, year),
                  meta = coalesce(meta, '{}'::jsonb) || coalesce($4, '{}'::jsonb),
                  image_url = coalesce($5, image_url),
                  wiki_summary = coalesce($6, wiki_summary),
                  wikipedia_id = $8,
                  is_atomic = $9,
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
          wikiToKeep,
          isAtomicToKeep
        ]);
      } else {
        // 3. INSERT new
        const isAtomic = n.is_atomic !== undefined ? !!n.is_atomic : (n.is_person !== undefined ? !!n.is_person : (n.type && n.type.toLowerCase() === 'person'));
        const insertSql = `
               insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary, is_atomic)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
          wikiSummary,
          isAtomic
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

async function upsertEdge(client: pg.PoolClient, atomicId: number, compositeId: number, label?: string) {
  await client.query(
    `
      insert into edges (atomic_id, composite_id, label)
      values ($1, $2, $3)
      on conflict (atomic_id, composite_id) do update
      set label = coalesce(excluded.label, edges.label), updated_at = now();
    `,
    [atomicId, compositeId, label || null]
  );
}

// Routes
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/init", async (_, res) => {
  const client = await pool.connect();
  try {
    await client.query("drop table if exists edges cascade");
    await client.query("drop table if exists nodes cascade");
    await client.query("drop table if exists saved_graphs cascade");
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

      // Get node type to know if we need atomic or composite neighbors
      const nodeRes = await client.query("select is_atomic from nodes where id = $1", [nodeId]);
      if (nodeRes.rows.length === 0) continue;
      const isAtomic = nodeRes.rows[0].is_atomic ?? false;

      // Get neighbors: if current node is atomic, get composites; if composite, get atomics
      const neighborsRes = await client.query(
        isAtomic
          ? `select composite_id as neighbor_id from edges where atomic_id = $1`
          : `select atomic_id as neighbor_id from edges where composite_id = $1`,
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
              is_atomic: node.is_atomic ?? (node.type?.toLowerCase() === 'person')
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
      join edges e on (e.atomic_id = n.id or e.composite_id = n.id)
      where (e.atomic_id = $1 or e.composite_id = $1) and n.id != $1
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
          return { 
            ...r, 
            meta: mergedMeta, 
            imageUrl: r.image_url, 
            wikiSummary: r.wiki_summary, 
            is_atomic: r.is_atomic ?? (r.type?.toLowerCase() === 'person'),
            is_person: r.is_atomic ?? (r.type?.toLowerCase() === 'person') 
          };
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

    // 1. Get source node is_atomic to know if it's an atomic or composite
    const sourceRes = await client.query("select is_atomic, type from nodes where id = $1", [sourceId]);
    if (sourceRes.rowCount === 0) throw new Error("Source node not found");
    const sourceIsAtomic = sourceRes.rows[0].is_atomic ?? (sourceRes.rows[0].type?.toLowerCase() === 'person');

    // 2. Upsert target nodes
    const idMap = await upsertNodes(client, nodes);

    // 3. Create edges
    for (const [key, targetId] of idMap.entries()) {
      const [title, type, wikiId] = key.split("|");

      let atomicId, compositeId;
      if (sourceIsAtomic) {
        // Source is an atomic, so source -> target is atomic -> composite
        atomicId = sourceId;
        compositeId = targetId;
      } else {
        // Source is a composite, so target -> source is atomic -> composite
        atomicId = targetId;
        compositeId = sourceId;
      }

      await upsertEdge(client, atomicId, compositeId);
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

// Saved Graphs Endpoints
app.get("/graphs", async (_, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query("select name, updated_at from saved_graphs order by name asc");
    res.json(result.rows);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get("/graphs/:name", async (req, res) => {
  const { name } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query("select data from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    res.json(result.rows[0].data);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post("/graphs", async (req, res) => {
  const { name, data } = req.body as { name: string; data: any };
  if (!name || !data) return res.status(400).json({ error: "name and data required" });

  const dataSize = JSON.stringify(data).length;
  console.log(`[${new Date().toISOString()}] Saving graph "${name}", size: ${(dataSize / 1024 / 1024).toFixed(2)} MB`);

  const client = await pool.connect();
  try {
    await client.query(
      `
      insert into saved_graphs (name, data, updated_at)
      values ($1, $2, now())
      on conflict (name) do update
      set data = excluded.data, updated_at = now()
      `,
      [name, data]
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete("/graphs/:name", async (req, res) => {
  const { name } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query("delete from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    res.json({ ok: true });
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
