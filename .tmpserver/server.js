import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fetch from "node-fetch";
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
        const edgeColsRes = await client.query("select column_name from information_schema.columns where table_name = 'edges' and column_name in ('atomic_id','composite_id','person_id','event_id')");
        const edgeCols = new Set(edgeColsRes.rows.map((r) => r.column_name));
        if (edgeCols.has('atomic_id')) {
            await client.query("create index if not exists edges_atomic_idx on edges (atomic_id)");
        }
        else if (edgeCols.has('person_id')) {
            await client.query("create index if not exists edges_person_idx on edges (person_id)");
        }
        if (edgeCols.has('composite_id')) {
            await client.query("create index if not exists edges_composite_idx on edges (composite_id)");
        }
        else if (edgeCols.has('event_id')) {
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
    }
    catch (e) {
        console.error("Schema init failed", e);
    }
    finally {
        if (client)
            client.release();
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
// Server-side DuckDuckGo image fetch (avoids browser CORS).
const fetchPosterFromDuckDuckGo = async (q) => {
    const exclude = ['logo', 'icon', 'emoji', 'svg', 'vector', 'clipart', 'cartoon', 'animated', 'posterized'];
    try {
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`;
        const pageRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
        const pageText = await pageRes.text();
        const vqdMatch = pageText.match(/vqd['"]?:['"]?([^'"]+)/);
        const vqd = vqdMatch?.[1];
        if (!vqd)
            return null;
        const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
        console.log(`[Poster][DDG] query="${q}" apiUrl=${apiUrl}`);
        const apiRes = await fetch(apiUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
        const data = await apiRes.json();
        const results = data?.results || [];
        for (const r of results) {
            const url = String(r?.image || r?.thumbnail || '');
            if (!url)
                continue;
            const lower = url.toLowerCase();
            if (exclude.some(p => lower.includes(p)))
                continue;
            console.log(`[Poster][DDG] candidate`, { url: r?.image, thumbnail: r?.thumbnail, title: r?.title });
            return url;
        }
    }
    catch (e) {
        console.warn("[Poster][DDG] failed", q, e);
    }
    return null;
};
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
let NODE_ATOMIC_COL = null;
async function getNodeAtomicCol(client) {
    if (NODE_ATOMIC_COL)
        return NODE_ATOMIC_COL;
    try {
        const colsRes = await client.query(`select column_name from information_schema.columns where table_name = 'nodes' and column_name in ('is_atomic','is_person')`);
        const cols = new Set(colsRes.rows.map((r) => r.column_name));
        if (cols.has('is_atomic'))
            NODE_ATOMIC_COL = 'is_atomic';
        else if (cols.has('is_person'))
            NODE_ATOMIC_COL = 'is_person';
        else
            NODE_ATOMIC_COL = null;
    }
    catch (e) {
        NODE_ATOMIC_COL = null;
    }
    return NODE_ATOMIC_COL;
}
// Upsert nodes batch and return mapping of (title, type, wikipedia_id) -> id
async function upsertNodes(client, nodes) {
    if (!nodes.length)
        return new Map();
    const idMap = new Map();
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
                ? await client.query(`select id, type, wikipedia_id from nodes where COALESCE(wikipedia_id, '') = $1 limit 1`, [normalizedWikiId])
                : { rows: [] };
            // 2. Prefer exact wiki_id + title/type (backwards compatibility)
            const exactRes = (normalizedWikiId && wikiRes.rows.length === 0)
                ? await client.query(`
            select id, type, wikipedia_id from nodes
            where lower(title) = lower($1) and lower(type) = lower($2) and COALESCE(wikipedia_id, '') = $3
            order by id
            limit 1
          `, [title, n.type, normalizedWikiId])
                : { rows: [] };
            // 3. Fallback: any node with same lower(title)/lower(type), prefer one that already has a wiki_id
            const fuzzyRes = (wikiRes.rows.length === 0 && exactRes.rows.length === 0)
                ? await client.query(`
            select id, type, wikipedia_id from nodes
            where lower(title) = lower($1) and lower(type) = lower($2)
            order by 
              case when wikipedia_id is not null and wikipedia_id != '' then 0 else 1 end,
              id
            limit 1
          `, [title, n.type])
                : { rows: [] };
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
                }
                else {
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
                }
            }
            else {
                // 3. INSERT new
                const isAtomic = n.is_atomic !== undefined ? !!n.is_atomic : (n.is_person !== undefined ? !!n.is_person : (n.type && n.type.toLowerCase() === 'person'));
                let insertSql;
                let insertParams;
                if (atomicCol) {
                    insertSql = `
                 insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary, ${atomicCol})
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 returning id
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
                }
                else {
                    insertSql = `
                 insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)
                 returning id
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
                const insertRes = await client.query(insertSql, insertParams);
                id = insertRes.rows[0].id;
            }
            const key = `${title}|${n.type}|${n.wikipedia_id || ''}`;
            idMap.set(key, id);
        }
        catch (e) {
            console.error("Upsert failed for node", n.title, e.message);
            // Continue best effort or re-throw? 
            // Logic suggests usually we want to proceed with other nodes if one fails, but explicit errors are helpful.
            // For now, re-throwing might block the entire batch, but it's consistent with previous behavior.
            throw e;
        }
    }
    return idMap;
}
async function upsertEdge(client, atomicId, compositeId, label, meta) {
    await client.query(`
      insert into edges (atomic_id, composite_id, label, meta)
      values ($1, $2, $3, $4)
      on conflict (atomic_id, composite_id) do update
      set 
        label = coalesce(excluded.label, edges.label), 
        meta = coalesce(edges.meta, '{}'::jsonb) || coalesce(excluded.meta, '{}'::jsonb),
        updated_at = now();
    `, [atomicId, compositeId, label || null, meta || {}]);
}
// Routes
app.get("/health", (_, res) => res.json({ ok: true }));
// ---- External source proxies (to avoid CORS / rate-limit issues) ----
// Crossref: DOI metadata (papers/authors/venues)
const crossrefCache = new Map();
const CROSSREF_TTL_MS = 1000 * 60 * 30; // 30 min
app.get("/api/crossref/work", async (req, res) => {
    const doiRaw = String(req.query?.doi || "").trim();
    if (!doiRaw)
        return res.status(400).json({ error: "doi required" });
    const doi = doiRaw.replace(/^https?:\/\/doi\.org\//i, "");
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const key = url;
    const now = Date.now();
    const cached = crossrefCache.get(key);
    if (cached && now - cached.t < CROSSREF_TTL_MS)
        return res.json(cached.json);
    try {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) {
            const text = await r.text().catch(() => "");
            return res.status(r.status).json({ error: `Crossref error: ${r.status} ${r.statusText}`, body: text.slice(0, 2000) });
        }
        const json = await r.json();
        crossrefCache.set(key, { t: now, json });
        return res.json(json);
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || "Crossref request failed" });
    }
});
app.post("/init", async (_, res) => {
    const client = await pool.connect();
    try {
        await client.query("drop table if exists edges cascade");
        await client.query("drop table if exists nodes cascade");
        await client.query("drop table if exists saved_graphs cascade");
        await client.query(initSql);
        res.json({ ok: true });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
// Find path between two nodes using database (BFS)
app.get("/path", async (req, res) => {
    const { startId, endId, maxDepth = "10" } = req.query;
    if (!startId || !endId)
        return res.status(400).json({ error: "startId and endId required" });
    const start = parseInt(startId);
    const end = parseInt(endId);
    const maxD = parseInt(maxDepth || "10");
    if (isNaN(start) || isNaN(end))
        return res.status(400).json({ error: "startId and endId must be numbers" });
    const client = await pool.connect();
    try {
        // BFS to find path between two nodes
        // Graph is bipartite: Person <-> Event <-> Person <-> Event...
        const visited = new Set();
        const queue = [{ nodeId: start, path: [start] }];
        visited.add(start);
        while (queue.length > 0) {
            const { nodeId, path } = queue.shift();
            if (path.length > maxD)
                continue; // Skip paths that exceed max depth
            // Get node type to know if we need atomic or composite neighbors
            const nodeRes = await client.query("select is_atomic from nodes where id = $1", [nodeId]);
            if (nodeRes.rows.length === 0)
                continue;
            const isAtomic = nodeRes.rows[0].is_atomic ?? false;
            // Get neighbors: if current node is atomic, get composites; if composite, get atomics
            const neighborsRes = await client.query(isAtomic
                ? `select composite_id as neighbor_id from edges where atomic_id = $1`
                : `select atomic_id as neighbor_id from edges where composite_id = $1`, [nodeId]);
            for (const row of neighborsRes.rows) {
                const neighborId = row.neighbor_id;
                if (neighborId === end) {
                    // Found path!
                    const fullPath = [...path, neighborId];
                    // Fetch all nodes in the path using parameterized query
                    const nodesRes = await client.query(`select * from nodes where id = ANY($1::int[])`, [fullPath]);
                    const nodeMap = new Map(nodesRes.rows.map(r => [r.id, r]));
                    const pathNodes = fullPath.map(id => {
                        const node = nodeMap.get(id);
                        if (!node)
                            return null;
                        const m = node.meta || {};
                        const mergedMeta = { ...m };
                        if (!mergedMeta.imageUrl && node.image_url)
                            mergedMeta.imageUrl = node.image_url;
                        if (!mergedMeta.wikiSummary && node.wiki_summary)
                            mergedMeta.wikiSummary = node.wiki_summary;
                        return {
                            ...node,
                            meta: mergedMeta,
                            imageUrl: node.image_url,
                            wikiSummary: node.wiki_summary,
                            is_atomic: node.is_atomic ?? (node.type?.toLowerCase() === 'person')
                        };
                    }).filter((n) => n !== null);
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
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
// Fetch expansion: return all neighbors of a node
app.get("/expansion", async (req, res) => {
    const { sourceId } = req.query;
    if (!sourceId)
        return res.status(400).json({ error: "sourceId required" });
    const id = parseInt(sourceId);
    if (isNaN(id))
        return res.status(400).json({ error: "sourceId must be a number" });
    const client = await pool.connect();
    try {
        // Fetch all nodes connected to this node
        const result = await client.query(`
      select n.*, e.label as edge_label, e.meta as edge_meta
      from nodes n
      join edges e on (
        (e.atomic_id = $1 and e.composite_id = n.id)
        or
        (e.composite_id = $1 and e.atomic_id = n.id)
      )
      where n.id != $1
      `, [id]);
        if (result.rowCount && result.rowCount > 0) {
            return res.json({
                hit: "exact",
                targets: result.rows.map(r => r.id),
                nodes: result.rows.map(r => {
                    const m = r.meta || {};
                    const mergedMeta = { ...m };
                    if (!mergedMeta.imageUrl && r.image_url)
                        mergedMeta.imageUrl = r.image_url;
                    if (!mergedMeta.wikiSummary && r.wiki_summary)
                        mergedMeta.wikiSummary = r.wiki_summary;
                    return {
                        ...r,
                        meta: mergedMeta,
                        imageUrl: r.image_url,
                        wikiSummary: r.wiki_summary,
                        is_atomic: r.is_atomic ?? (r.type?.toLowerCase() === 'person'),
                        is_person: r.is_atomic ?? (r.type?.toLowerCase() === 'person'),
                        edge_label: r.edge_label ?? null,
                        edge_meta: r.edge_meta ?? null
                    };
                })
            });
        }
        return res.json({ hit: "miss" });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
// Save expansion
app.post("/expansion", async (req, res) => {
    const { sourceId, nodes } = req.body;
    if (!sourceId || !nodes)
        return res.status(400).json({ error: "sourceId and nodes required" });
    const client = await pool.connect();
    try {
        await client.query("begin");
        // 1. Get source node is_atomic to know if it's an atomic or composite
        const sourceRes = await client.query("select is_atomic, type from nodes where id = $1", [sourceId]);
        if (sourceRes.rowCount === 0)
            throw new Error("Source node not found");
        const sourceIsAtomic = sourceRes.rows[0].is_atomic ?? (sourceRes.rows[0].type?.toLowerCase() === 'person');
        // 2. Upsert target nodes
        // Build key->node payload map so we can also persist edge evidence (label/meta)
        const nodeByKey = new Map();
        for (const n of nodes) {
            const title = n.title || n.id;
            const wikiId = (n.wikipedia_id || n.wikipediaId || "").toString().trim();
            const key = `${title}|${n.type}|${wikiId || ''}`;
            nodeByKey.set(key, n);
        }
        const idMap = await upsertNodes(client, nodes);
        // 3. Create edges
        for (const [key, targetId] of idMap.entries()) {
            const [title, type, wikiId] = key.split("|");
            let atomicId, compositeId;
            if (sourceIsAtomic) {
                // Source is an atomic, so source -> target is atomic -> composite
                atomicId = sourceId;
                compositeId = targetId;
            }
            else {
                // Source is a composite, so target -> source is atomic -> composite
                atomicId = targetId;
                compositeId = sourceId;
            }
            const payload = nodeByKey.get(key);
            const edgeLabel = payload?.edge_label || payload?.label || null;
            const edgeMeta = payload?.edge_meta || payload?.meta_edge || null;
            await upsertEdge(client, atomicId, compositeId, edgeLabel || undefined, edgeMeta || undefined);
        }
        await client.query("commit");
        res.json({ ok: true });
    }
    catch (e) {
        await client.query("rollback");
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
// Upsert a single node
app.post("/node", async (req, res) => {
    const node = req.body;
    if (!node.title && !node.id)
        return res.status(400).json({ error: "title required" });
    if (!node.type)
        return res.status(400).json({ error: "type required" });
    const client = await pool.connect();
    try {
        const idMap = await upsertNodes(client, [{
                title: node.title || node.id,
                type: node.type,
                description: node.description ?? null,
                year: node.year ?? null,
                meta: node.meta ?? {},
                wikipedia_id: node.wikipedia_id ?? null
            }]);
        const id = Array.from(idMap.values())[0];
        res.json({ ok: true, id });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
// Saved Graphs Endpoints
app.get("/graphs", async (_, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query("select name, updated_at from saved_graphs order by name asc");
        res.json(result.rows);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
app.get("/graphs/:name", async (req, res) => {
    const { name } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("select data from saved_graphs where name = $1", [name]);
        if (result.rowCount === 0)
            return res.status(404).json({ error: "Graph not found" });
        res.json(result.rows[0].data);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
app.post("/graphs", async (req, res) => {
    const { name, data } = req.body;
    if (!name || !data)
        return res.status(400).json({ error: "name and data required" });
    const dataSize = JSON.stringify(data).length;
    console.log(`[${new Date().toISOString()}] Saving graph "${name}", size: ${(dataSize / 1024 / 1024).toFixed(2)} MB`);
    const client = await pool.connect();
    try {
        await client.query(`
      insert into saved_graphs (name, data, updated_at)
      values ($1, $2, now())
      on conflict (name) do update
      set data = excluded.data, updated_at = now()
      `, [name, data]);
        res.json({ ok: true });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
app.delete("/graphs/:name", async (req, res) => {
    const { name } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("delete from saved_graphs where name = $1", [name]);
        if (result.rowCount === 0)
            return res.status(404).json({ error: "Graph not found" });
        res.json({ ok: true });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
    finally {
        client.release();
    }
});
// Poster proxy endpoint (server-side image lookup to avoid browser CORS).
app.get("/api/poster", async (req, res) => {
    const title = String(req.query.title || "").trim();
    const context = String(req.query.context || "").trim();
    if (!title)
        return res.status(400).json({ error: "title is required" });
    const q = `${title} ${context}`.trim();
    const fetchWikidataImageForTitle = async () => {
        try {
            const ppUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}&redirects=1&origin=*`;
            const ppRes = await fetch(ppUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
            const ppData = await ppRes.json();
            const pages = ppData?.query?.pages;
            const page = pages ? Object.values(pages)[0] : null;
            const qid = page?.pageprops?.wikibase_item;
            if (!qid || !/^Q\d+$/.test(qid))
                return null;
            const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qid}&origin=*`;
            const wdRes = await fetch(wdUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
            const wdData = await wdRes.json();
            const claims = wdData?.entities?.[qid]?.claims;
            const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
            if (!p18)
                return null;
            const imgTitle = p18.startsWith('File:') ? p18 : `File:${p18}`;
            const imgInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(imgTitle)}&iiprop=url&iiurlwidth=800&origin=*`;
            const imgRes = await fetch(imgInfoUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
            const imgData = await imgRes.json();
            const pagesInfo = imgData?.query?.pages;
            const imgPage = pagesInfo ? Object.values(pagesInfo)[0] : null;
            const info = imgPage?.imageinfo?.[0];
            return info?.thumburl || info?.url || null;
        }
        catch (e) {
            console.warn("[Poster][Wikidata] failed", title, e);
            return null;
        }
    };
    const fetchWikipediaPageImage = async () => {
        try {
            const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(title)}&pithumbsize=800&redirects=1&origin=*`;
            const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
            const data = await resp.json();
            const pages = data?.query?.pages;
            const page = pages ? Object.values(pages)[0] : null;
            return page?.thumbnail?.source || null;
        }
        catch (e) {
            console.warn("[Poster][PageImage] failed", title, e);
            return null;
        }
    };
    try {
        const fromWikidata = await fetchWikidataImageForTitle();
        if (fromWikidata)
            return res.status(200).json({ url: fromWikidata, source: "wikidata" });
        const fromPageImage = await fetchWikipediaPageImage();
        if (fromPageImage)
            return res.status(200).json({ url: fromPageImage, source: "pageimage" });
        const fromDdg = await fetchPosterFromDuckDuckGo(q);
        if (fromDdg)
            return res.status(200).json({ url: fromDdg, source: "ddg" });
        return res.status(200).json({ url: null });
    }
    catch (e) {
        console.warn("[Poster] error for", q, e);
        return res.status(500).json({ error: e?.message || "poster fetch failed" });
    }
});
const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`Cache server listening on ${port}`);
});
