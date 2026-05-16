import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pg from "pg";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { fetchConnections, fetchPersonWorks, classifyEntity, classifyStartPair, fetchConnectionPath, findWikipediaTitle, fetchOrgKeyPeopleBlockViaSearch, sanitizeSearchTerm, setServerLlmOverride } from "./services/aiService";
import type { LlmProviderId } from "./services/aiUtils";
import { setServerLlmModelOverride } from "./services/aiUtils";
import { fetchWikipediaSummary } from "./services/wikipediaService";
import { resolveImageForTitle, fetchDuckDuckGoImages } from "./services/resolveImageForTitle";
import { fetchAllModels, fetchModelsForProvider } from "./services/modelsService";

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

    // Edge evidence storage
    await client.query("alter table if exists edges add column if not exists meta jsonb default '{}'::jsonb");

    // Edges indexes: handle old schema (person_id/event_id) and new schema (atomic_id/composite_id)
    // Drop old indexes if they exist (safe).
    await client.query("drop index if exists edges_person_idx");
    await client.query("drop index if exists edges_event_idx");
    await client.query("drop index if exists edges_atomic_idx");
    await client.query("drop index if exists edges_composite_idx");
    const edgeColsRes = await client.query(
      "select column_name from information_schema.columns where table_name = 'edges' and column_name in ('atomic_id','composite_id','person_id','event_id')"
    );
    const edgeCols = new Set(edgeColsRes.rows.map((r: any) => r.column_name));
    if (edgeCols.has('atomic_id')) {
      await client.query("create index if not exists edges_atomic_idx on edges (atomic_id)");
    } else if (edgeCols.has('person_id')) {
      await client.query("create index if not exists edges_person_idx on edges (person_id)");
    }
    if (edgeCols.has('composite_id')) {
      await client.query("create index if not exists edges_composite_idx on edges (composite_id)");
    } else if (edgeCols.has('event_id')) {
      await client.query("create index if not exists edges_event_idx on edges (event_id)");
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
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use((_, __, next) => next());

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
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(atomic_id, composite_id)
);

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

// Backwards-compatible detection of which boolean column represents the "atomic" side.
// Older deployments used nodes.is_person.
let NODE_ATOMIC_COL: 'is_atomic' | 'is_person' | null = null;
async function getNodeAtomicCol(client: pg.PoolClient): Promise<'is_atomic' | 'is_person' | null> {
  if (NODE_ATOMIC_COL) return NODE_ATOMIC_COL;
  try {
    const colsRes = await client.query(
      `select column_name from information_schema.columns where table_name = 'nodes' and column_name in ('is_atomic','is_person')`
    );
    const cols = new Set(colsRes.rows.map((r: any) => r.column_name));
    if (cols.has('is_atomic')) NODE_ATOMIC_COL = 'is_atomic';
    else if (cols.has('is_person')) NODE_ATOMIC_COL = 'is_person';
    else NODE_ATOMIC_COL = null;
  } catch (e) {
    NODE_ATOMIC_COL = null;
  }
  return NODE_ATOMIC_COL;
}

// Upsert nodes batch and return mapping of (title, type, wikipedia_id) -> id
// Upsert nodes batch and return mapping of (title, type, wikipedia_id) -> full node object
async function upsertNodes(client: pg.PoolClient, nodes: any[]): Promise<Map<string, any>> {
  if (!nodes.length) return new Map();

  const nodeMap = new Map<string, any>();
  const atomicCol = await getNodeAtomicCol(client);

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

      let row;
      const matchRow = wikiRes.rows[0] || exactRes.rows[0] || fuzzyRes.rows[0];

      if (matchRow) {
        // 2. UPDATE existing node (duplicate found)
        const matchId = matchRow.id;
        const existingType = matchRow.type;
        const existingWiki = matchRow.wikipedia_id || '';
        // Prefer the more specific type (capitalized like "Movie" over lowercase like "event")
        const typeToKeep = (existingType && existingType !== existingType.toLowerCase()) ? existingType : n.type;
        const wikiToKeep = existingWiki || normalizedWikiId || '';

        // Use provided is_atomic flag, or default to checking type for legacy data
        const isAtomicToKeep = n.is_atomic !== undefined ? !!n.is_atomic : (n.is_person !== undefined ? !!n.is_person : (typeToKeep && typeToKeep.toLowerCase() === 'person'));

        if (atomicCol) {
          const updateSql = `
                  update nodes set
                    type = $1,
                    description = coalesce($2, description),
                    year = coalesce($3, year),
                    meta = coalesce(meta, '{}'::jsonb) || coalesce($4, '{}'::jsonb),
                    image_url = coalesce($5, image_url),
                    wiki_summary = coalesce($6, wiki_summary),
                    wikipedia_id = $8,
                    ${atomicCol} = $9,
                    updated_at = now()
                  where id = $7
                  returning *
               `;
          const updateRes = await client.query(updateSql, [
            typeToKeep,
            n.description ?? null,
            n.year ?? null,
            meta,
            imageUrl,
            wikiSummary,
            matchId,
            wikiToKeep,
            isAtomicToKeep
          ]);
          row = updateRes.rows[0];
        } else {
          const updateSql = `
                  update nodes set
                    type = $1,
                    description = coalesce($2, description),
                    year = coalesce($3, year),
                    meta = coalesce(meta, '{}'::jsonb) || coalesce($4, '{}'::jsonb),
                    image_url = coalesce($5, image_url),
                    wiki_summary = coalesce($6, wiki_summary),
                    wikipedia_id = $8,
                    updated_at = now()
                  where id = $7
                  returning *
               `;
          const updateRes = await client.query(updateSql, [
            typeToKeep,
            n.description ?? null,
            n.year ?? null,
            meta,
            imageUrl,
            wikiSummary,
            matchId,
            wikiToKeep
          ]);
          row = updateRes.rows[0];
        }
      } else {
        // 3. INSERT new
        const isAtomic = n.is_atomic !== undefined ? !!n.is_atomic : (n.is_person !== undefined ? !!n.is_person : (n.type && n.type.toLowerCase() === 'person'));
        let insertSql: string;
        let insertParams: any[];
        if (atomicCol) {
          insertSql = `
                 insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary, ${atomicCol})
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 returning *
               `;
          insertParams = [
            title,
            n.type,
            n.description ?? null,
            n.year ?? null,
            meta,
            normalizedWikiId,
            imageUrl,
            wikiSummary,
            isAtomic
          ];
        } else {
          insertSql = `
                 insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)
                 returning *
               `;
          insertParams = [
            title,
            n.type,
            n.description ?? null,
            n.year ?? null,
            meta,
            normalizedWikiId,
            imageUrl,
            wikiSummary
          ];
        }
        await client.query("savepoint upsert_node");
        try {
          const insertRes = await client.query(insertSql, insertParams);
          row = insertRes.rows[0];
          await client.query("release savepoint upsert_node");
        } catch (insertErr: any) {
          await client.query("rollback to savepoint upsert_node");
          if (insertErr.code === '23505') {
            // Race condition: another concurrent request inserted the same node between our SELECT
            // and INSERT. Roll back to the savepoint so the transaction stays alive, then SELECT
            // the winning row.
            const fallbackRes = await client.query(
              `select * from nodes where lower(title) = lower($1) and lower(type) = lower($2) and COALESCE(wikipedia_id, '') = $3 limit 1`,
              [title, n.type, normalizedWikiId]
            );
            if (fallbackRes.rows[0]) {
              row = fallbackRes.rows[0];
            } else {
              throw insertErr;
            }
          } else {
            throw insertErr;
          }
        }
      }

      if (row) {
        // Map this input node to the resulting database row
        const key = `${normalizedWikiId}|${(n.title || n.id || "").toString().toLowerCase()}|${(n.type || "").toString().toLowerCase()}`;
        nodeMap.set(key, {
          ...row,
          imageUrl: row.image_url,
          wikiSummary: row.wiki_summary,
          is_atomic: row.is_atomic ?? (row.type?.toLowerCase() === 'person')
        });
      }
    } catch (e: any) {
      console.error("Upsert failed for node", n.title, e.message);
      throw e;
    }
  }
  return nodeMap;
}

// ---- CLI Expansion Endpoint ----
app.post("/api/expand", async (req, res) => {
  const { query, context, atomicType, compositeType } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    // 1. Wikipedia/Grounding
    const wiki = await fetchWikipediaSummary(query, context);

    // 2. Classification (if needed)
    let isAtomic = (atomicType || '').toLowerCase() === 'person';
    let type = atomicType;

    if (!type) {
      const classification = await classifyEntity(query, wiki.extract || undefined);
      isAtomic = classification.isAtomic;
      type = classification.type;
    }

    // 3. Expansion
    let data;
    if (isAtomic) {
      data = await fetchPersonWorks(
        query,
        [],
        wiki.extract || undefined,
        wiki.pageid?.toString(),
        atomicType,
        compositeType,
        wiki.mentioningPageTitles || undefined
      );
    } else {
      data = await fetchConnections(
        query,
        context,
        [],
        wiki.extract || undefined,
        wiki.pageid?.toString(),
        atomicType,
        compositeType,
        wiki.mentioningPageTitles || undefined
      );
    }

    res.json({
      query,
      wiki,
      type,
      isAtomic,
      data
    });
  } catch (e: any) {
    console.error("Expand failed", e);
    res.status(500).json({ error: e.message });
  }
});

async function upsertEdge(client: pg.PoolClient, atomicId: number, compositeId: number, label?: string, meta?: any) {
  await client.query(
    `
      insert into edges (atomic_id, composite_id, label, meta)
      values ($1, $2, $3, $4)
      on conflict (atomic_id, composite_id) do update
      set 
        label = coalesce(excluded.label, edges.label), 
        meta = coalesce(edges.meta, '{}'::jsonb) || coalesce(excluded.meta, '{}'::jsonb),
        updated_at = now();
    `,
    [atomicId, compositeId, label || null, meta || {}]
  );
}

// Routes
app.get("/health", (_, res) => res.json({ ok: true }));

// ---- External source proxies (to avoid CORS / rate-limit issues) ----
// Crossref: DOI metadata (papers/authors/venues)
const crossrefCache = new Map<string, { t: number; json: any }>();
const CROSSREF_TTL_MS = 1000 * 60 * 30; // 30 min
app.get("/api/crossref/work", async (req, res) => {
  const doiRaw = String((req.query as any)?.doi || "").trim();
  if (!doiRaw) return res.status(400).json({ error: "doi required" });
  const doi = doiRaw.replace(/^https?:\/\/doi\.org\//i, "");
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const key = url;
  const now = Date.now();
  const cached = crossrefCache.get(key);
  if (cached && now - cached.t < CROSSREF_TTL_MS) return res.json(cached.json);

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `Crossref error: ${r.status} ${r.statusText}`, body: text.slice(0, 2000) });
    }
    const json = await r.json();
    crossrefCache.set(key, { t: now, json });
    return res.json(json);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Crossref request failed" });
  }
});

app.post("/init", async (_, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("drop table if exists edges cascade");
    await client.query("drop table if exists nodes cascade");
    await client.query("drop table if exists saved_graphs cascade");
    await client.query(initSql);
    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

// Clear all cached data (nodes and edges)
app.delete("/cache/clear", async (_, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Delete all edges first (to avoid foreign key constraints)
    const edgesResult = await client.query("DELETE FROM edges");
    const edgesDeleted = edgesResult.rowCount || 0;

    // Delete all nodes
    const nodesResult = await client.query("DELETE FROM nodes");
    const nodesDeleted = nodesResult.rowCount || 0;

    await client.query("COMMIT");

    res.json({
      ok: true,
      message: "Cache cleared successfully",
      deleted: { nodes: nodesDeleted, edges: edgesDeleted }
    });
  } catch (e: any) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Failed to clear cache:", e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
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

  let client;
  try {
    client = await pool.connect();
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
            const node = nodeMap.get(id) as any;
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
    if (client) client.release();
  }
});

// Fetch expansion: return all neighbors of a node
app.get("/expansion", async (req, res) => {
  const { sourceId } = req.query as { sourceId?: string };
  if (!sourceId) return res.status(400).json({ error: "sourceId required" });

  const id = parseInt(sourceId);
  if (isNaN(id)) return res.status(400).json({ error: "sourceId must be a number" });

  let client;
  try {
    client = await pool.connect();
    // Fetch all nodes connected to this node
    const result = await client.query(
      `
      select n.*, e.label as edge_label, e.meta as edge_meta
      from nodes n
      join edges e on (
        (e.atomic_id = $1 and e.composite_id = n.id)
        or
        (e.composite_id = $1 and e.atomic_id = n.id)
      )
      where n.id != $1
      `,
      [id]
    );

    if (result.rowCount && result.rowCount > 0) {
      return res.json({
        hit: "exact",
        targets: result.rows.map(r => r.id),
        nodes: result.rows.map(r => {
          const m = (r as any).meta || {};
          const mergedMeta = { ...m };
          if (!mergedMeta.imageUrl && (r as any).image_url) mergedMeta.imageUrl = (r as any).image_url;
          if (!mergedMeta.wikiSummary && (r as any).wiki_summary) mergedMeta.wikiSummary = (r as any).wiki_summary;
          return {
            ...r,
            meta: mergedMeta,
            imageUrl: (r as any).image_url,
            wikiSummary: (r as any).wiki_summary,
            is_atomic: (r as any).is_atomic ?? ((r as any).type?.toLowerCase() === 'person'),
            is_person: (r as any).is_atomic ?? ((r as any).type?.toLowerCase() === 'person'),
            edge_label: (r as any).edge_label ?? null,
            edge_meta: (r as any).edge_meta ?? null
          };
        })
      });
    }

    return res.json({ hit: "miss" });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

// Save expansion
app.post("/expansion", async (req, res) => {
  const { sourceId, nodes } = req.body as {
    sourceId: number;
    nodes: any[];      // nodes to upsert
  };

  if (!sourceId || !nodes) return res.status(400).json({ error: "sourceId and nodes required" });

  let client;
  try {
    client = await pool.connect();
    await client.query("begin");

    // 1. Get source node is_atomic to know if it's an atomic or composite
    const sourceRes = await client.query("select is_atomic, type from nodes where id = $1", [sourceId]);
    if (sourceRes.rowCount === 0) {
      await client.query("rollback");
      client.release();
      client = undefined;
      return res.json({ ok: true, skipped: true, reason: "source node not in db" });
    }
    const sourceIsAtomic = sourceRes.rows[0].is_atomic ?? (sourceRes.rows[0].type?.toLowerCase() === 'person');

    // 2. Upsert target nodes
    const nodeMap = await upsertNodes(client, nodes);

    // 3. Create edges
    for (const n of nodes) {
      const normalizedWikiId = (n.wikipedia_id || n.wikipediaId || "").toString().trim();
      const key = `${normalizedWikiId}|${(n.title || n.id || "").toString().toLowerCase()}|${(n.type || "").toString().toLowerCase()}`;
      const dbNode = nodeMap.get(key);
      if (!dbNode) continue;

      const targetId = dbNode.id;
      let atomicId, compositeId;
      if (sourceIsAtomic) {
        atomicId = sourceId;
        compositeId = targetId;
      } else {
        atomicId = targetId;
        compositeId = sourceId;
      }

      const edgeLabel = n.edge_label || n.label || null;
      const edgeMeta = n.edge_meta || n.meta_edge || null;
      await upsertEdge(client, atomicId, compositeId, edgeLabel || undefined, edgeMeta || undefined);
    }

    await client.query("commit");
    res.json({ ok: true });
  } catch (e: any) {
    if (client) await client.query("rollback").catch(() => {});
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

// Upsert a single node
app.post("/node", async (req, res) => {
  const node = req.body as { title?: string; type?: string; description?: string | null; year?: number | null; meta?: any; wikipedia_id?: string };
  if (!node.title && !(node as any).id) return res.status(400).json({ error: "title required" });
  if (!node.type) return res.status(400).json({ error: "type required" });

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const nodeMap = await upsertNodes(client, [{
      title: node.title || (node as any).id,
      type: node.type,
      description: node.description ?? null,
      year: node.year ?? null,
      meta: node.meta ?? {},
      wikipedia_id: node.wikipedia_id ?? null
    }]);
    await client.query("COMMIT");

    const title = node.title || (node as any).id || "";
    const type = node.type || "";
    const wikiId = (node.wikipedia_id || "").toString().trim();
    const key = `${wikiId}|${title.toLowerCase()}|${type.toLowerCase()}`;
    const dbNode = nodeMap.get(key);
    res.json({ ok: true, id: dbNode?.id, ...dbNode });
  } catch (e: any) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

// Saved Graphs Endpoints
app.get("/graphs", async (_, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query("select name, updated_at from saved_graphs order by name asc");
    res.json(result.rows);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

app.get("/graphs/:name", async (req, res) => {
  const { name } = req.params;
  let client;
  try {
    client = await pool.connect();
    const result = await client.query("select data from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    res.json(result.rows[0].data);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});

app.post("/graphs", async (req, res) => {
  const { name, data } = req.body as { name: string; data: any };
  if (!name || !data) return res.status(400).json({ error: "name and data required" });

  let client;
  try {
    client = await pool.connect();
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
    if (client) client.release();
  }
});

app.delete("/graphs/:name", async (req, res) => {
  const { name } = req.params;
  let client;
  try {
    client = await pool.connect();
    const result = await client.query("delete from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (client) client.release();
  }
});


app.get("/api/image", async (req, res) => {
  const title = String(req.query.title || "").trim();
  const context = String(req.query.context || "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const result = await resolveImageForTitle(title, context);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "image fetch failed" });
  }
});

// Poster proxy endpoint (alias to /api/image).
app.get("/api/poster", async (req, res) => {
  const title = String(req.query.title || "").trim();
  const context = String(req.query.context || "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const result = await resolveImageForTitle(title, context);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "poster fetch failed" });
  }
});

// Simple DDG image probe for debugging.
app.get("/api/ddg-image-test", async (req, res) => {
  const q = String(req.query.title || req.query.q || "").trim();
  const limit = Number(req.query.limit || 10);
  if (!q) return res.status(400).json({ error: "title (or q) is required" });
  const results = await fetchDuckDuckGoImages(q, isNaN(limit) ? 10 : limit);
  return res.status(200).json({ query: q, count: results.length, results });
});

// --- Models Endpoint ---
app.get("/api/models", async (req, res) => {
  const provider = typeof req.query.provider === "string" ? req.query.provider : null;
  try {
    const models = provider ? await fetchModelsForProvider(provider) : await fetchAllModels();
    return res.json({ models });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "models fetch failed" });
  }
});

// --- AI Proxy Endpoints ---

/** Returns true if this server has credentials for the given provider. */
function serverHasCredentials(provider: string): boolean {
  switch (provider) {
    case "gemini":  return !!(process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || process.env.VITE_GEMINI_API_KEY);
    case "deepseek": return !!process.env.VITE_DEEPSEEK_API_KEY;
    case "openai":     return !!process.env.VITE_OPENAI_API_KEY;
    case "anthropic":  return !!process.env.VITE_ANTHROPIC_API_KEY;
    default:           return false;
  }
}

/** Returns the first provider this server has credentials for, or "gemini" as last resort. */
function firstAvailableProvider(): LlmProviderId {
  for (const p of ["deepseek", "gemini", "openai"] as LlmProviderId[]) {
    if (serverHasCredentials(p)) return p;
  }
  return "gemini";
}

/** Honor the browser's provider+model choice, but fall back if this server lacks credentials. */
function applyProviderFromRequest(req: express.Request): void {
  const requested = req.body?.llmProvider;
  let activeProvider: string | null = null;
  if (requested && typeof requested === "string" && serverHasCredentials(requested)) {
    setServerLlmOverride(requested as LlmProviderId);
    activeProvider = requested;
  } else {
    if (requested && !serverHasCredentials(requested)) {
      const fallback = firstAvailableProvider();
      setServerLlmOverride(fallback);
      activeProvider = fallback;
      console.warn(`⚠️ [LLM] No key for "${requested}" — using ${fallback}`);
    } else {
      setServerLlmOverride(null);
    }
  }
  const model = req.body?.llmModel;
  setServerLlmModelOverride(model && typeof model === "string" ? model : null);
  if (activeProvider) console.log(`🤖 [LLM] ${activeProvider}${model ? ` / ${model}` : ""}`);
}

app.post("/api/ai/classify-start", async (req, res) => {
  applyProviderFromRequest(req);
  const raw = req.body.term;
  if (!raw) return res.status(400).json({ error: "term is required" });
  const term = sanitizeSearchTerm(raw);
  const { wikiContext } = req.body;
  try {
    const result = await classifyStartPair(term, wikiContext);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/classify", async (req, res) => {
  applyProviderFromRequest(req);
  const raw = req.body.term;
  if (!raw) return res.status(400).json({ error: "term is required" });
  const term = sanitizeSearchTerm(raw);
  const { wikiContext } = req.body;
  try {
    const result = await classifyEntity(term, wikiContext);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/connections", async (req, res) => {
  applyProviderFromRequest(req);
  const { nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles } = req.body;
  if (!nodeName) return res.status(400).json({ error: "nodeName is required" });
  try {
    const result = await fetchConnections(nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/works", async (req, res) => {
  applyProviderFromRequest(req);
  const { nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles } = req.body;
  if (!nodeName) return res.status(400).json({ error: "nodeName is required" });
  try {
    const result = await fetchPersonWorks(nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/path", async (req, res) => {
  applyProviderFromRequest(req);
  const { start, end, context } = req.body;
  if (!start || !end) return res.status(400).json({ error: "start and end are required" });
  try {
    const result = await fetchConnectionPath(start, end, context);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/title", async (req, res) => {
  applyProviderFromRequest(req);
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const result = await findWikipediaTitle(name, description);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/search-org", async (req, res) => {
  const { orgName } = req.body;
  if (!orgName) return res.status(400).json({ error: "orgName is required" });
  try {
    const result = await fetchOrgKeyPeopleBlockViaSearch(orgName);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Dev docs ---
const DOC_STYLE = `<style>body{font-family:ui-monospace,monospace;max-width:900px;margin:2rem auto;padding:0 1.5rem 4rem;background:#0f172a;color:#e2e8f0;line-height:1.6}h1,h2,h3{color:#f1f5f9;margin-top:2rem}h1{color:#c084fc}code{background:#1e293b;padding:.1em .35em;border-radius:3px;font-size:.9em}pre code{background:none;padding:0}pre{background:#1e293b;padding:1rem;border-radius:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word}a{color:#818cf8}hr{border-color:#334155}table{border-collapse:collapse;width:100%}td,th{border:1px solid #334155;padding:.4rem .7rem;text-align:left}th{background:#1e293b}</style>`;

function serveMarkdown(filePath: string, title: string, res: express.Response) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    // Very minimal markdown → HTML: fences, headings, bold, code, links, lists, tables, hr
    const html = raw
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, m.lastIndexOf("```")).replace(/^[a-z]*\n/, "")}</code></pre>`)
      .replace(/^#{3} (.+)$/gm, "<h3>$1</h3>")
      .replace(/^#{2} (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^---$/gm, "<hr>")
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
      .replace(/\n\n/g, "</p><p>")
      .replace(/^(?!<[hupoli]|<pre|<hr|<strong|<code|<a|<table|<tr|<th|<td)(.+)$/gm, "$1");
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${DOC_STYLE}</head><body><p>${html}</p></body></html>`);
  } catch {
    res.status(404).send("Not found");
  }
}

app.get("/docs/about", (_, res) => serveMarkdown(path.join(path.dirname(fileURLToPath(import.meta.url)), "CLAUDE.md"), "About — Constellations", res));
app.get("/docs/prompt", (_, res) => serveMarkdown(path.join(path.dirname(fileURLToPath(import.meta.url)), "PROMPT.md"), "Prompt — Constellations", res));
app.get("/docs/journal", (_, res) => serveMarkdown(path.join(path.dirname(fileURLToPath(import.meta.url)), "DEV_JOURNAL.md"), "Dev Journal — Constellations", res));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Cache server listening on ${port}`);
});
