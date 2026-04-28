import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pg from "pg";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { fetchConnections, fetchPersonWorks, classifyEntity, classifyStartPair, fetchConnectionPath, findWikipediaTitle, fetchOrgKeyPeopleBlockViaSearch, defaultStartPairResult, getLlmProvider } from "./services/geminiService";
import { fetchWikipediaSummary } from "./services/wikipediaService";

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

// Log requests for debugging
app.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${req.get('content-length') || 0} bytes`);
  }
  next();
});

// Server-side DuckDuckGo image fetch (avoids browser CORS).
const fetchPosterFromDuckDuckGo = async (q: string): Promise<string | null> => {
  const exclude = ['logo', 'icon', 'emoji', 'svg', 'vector', 'clipart', 'cartoon', 'animated', 'posterized'];
  try {
    const candidates = await fetchDuckDuckGoImages(q, 10);
    console.log("[Poster][DDG] results", candidates.length);
    for (const r of candidates) {
      const url = String(r?.image || r?.thumbnail || '');
      if (!url) continue;
      const lower = url.toLowerCase();
      if (exclude.some(p => lower.includes(p))) continue;
      console.log(`[Poster][DDG] candidate`, { url: r?.image, thumbnail: r?.thumbnail, title: r?.title });
      return url;
    }
  } catch (e) {
    console.warn("[Poster][DDG] failed", q, e);
  }
  return null;
};

// Raw DuckDuckGo image fetch for testing (returns top N results without filtering).
const fetchDuckDuckGoImages = async (q: string, limit: number = 10): Promise<Array<{ image?: string; thumbnail?: string; title?: string }>> => {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Accept-Language': 'en-US,en;q=0.9'
  };
  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`;
    const pageRes = await fetch(searchUrl, { headers });
    if (!pageRes.ok) {
      console.warn("[DDG-Test] search status", pageRes.status, q);
      return [];
    }
    const pageText = await pageRes.text();
    const vqdMatch = pageText.match(/vqd=['"]?([^'"&]+)/);
    const vqd = vqdMatch?.[1];
    if (!vqd) {
      console.warn("[DDG-Test] missing vqd for query", q);
      return [];
    }

    const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
    const apiRes = await fetch(apiUrl, {
      headers: {
        ...headers,
        Referer: searchUrl,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (!apiRes.ok) {
      console.warn("[DDG-Test] api status", apiRes.status, q);
      return [];
    }
    const data = await apiRes.json();
    const results: any[] = data?.results || [];
    return results.slice(0, limit).map(r => ({
      image: r?.image,
      thumbnail: r?.thumbnail,
      title: r?.title
    }));
  } catch {
    return [];
  }
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
        const insertRes = await client.query(insertSql, insertParams);
        row = insertRes.rows[0];
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

  console.log(`📡 [CLI] Expansion requested for "${query}"`);

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
    console.log("🗑️  Clearing all cached data...");
    await client.query("BEGIN");

    // Delete all edges first (to avoid foreign key constraints)
    const edgesResult = await client.query("DELETE FROM edges");
    const edgesDeleted = edgesResult.rowCount || 0;

    // Delete all nodes
    const nodesResult = await client.query("DELETE FROM nodes");
    const nodesDeleted = nodesResult.rowCount || 0;

    await client.query("COMMIT");

    console.log(`✅ Cache cleared: ${nodesDeleted} nodes, ${edgesDeleted} edges deleted`);
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
    if (sourceRes.rowCount === 0) throw new Error("Source node not found");
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
    const nodeMap = await upsertNodes(client, [{
      title: node.title || (node as any).id,
      type: node.type,
      description: node.description ?? null,
      year: node.year ?? null,
      meta: node.meta ?? {},
      wikipedia_id: node.wikipedia_id ?? null
    }]);

    const title = node.title || (node as any).id || "";
    const type = node.type || "";
    const wikiId = (node.wikipedia_id || "").toString().trim();
    const key = `${wikiId}|${title.toLowerCase()}|${type.toLowerCase()}`;
    const dbNode = nodeMap.get(key);
    res.json({ ok: true, id: dbNode?.id, ...dbNode });
  } catch (e: any) {
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

  const dataSize = JSON.stringify(data).length;
  console.log(`[${new Date().toISOString()}] Saving graph "${name}", size: ${(dataSize / 1024 / 1024).toFixed(2)} MB`);

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

const resolveImageForTitle = async (title: string, context: string): Promise<{ url: string | null; source?: string }> => {
  const trimmedTitle = title.trim();
  const trimmedContext = context.trim();
  const looksLikeScreenWork = (s: string) => /\b(film|movie|television series|tv series|miniseries|sitcom|drama series|comedy series|series)\b/i.test(s.toLowerCase());
  // Recognize person types: exact match OR if context contains person-related type (Actor, Musician, etc.)
  const isPersonContext = (s: string) => {
    const normalized = s.trim().toLowerCase();
    // Exact matches
    if (/^(person|author|actor|musician|artist|scientist|mathematician|researcher)$/i.test(normalized)) return true;
    // Check if context contains person type anywhere (e.g., "Actor ↔ Movie")
    if (/\b(person|author|actor|musician|artist|scientist|mathematician|researcher|composer|director|writer|poet|playwright)\b/i.test(normalized)) return true;
    return false;
  };
  let isScreenWork = looksLikeScreenWork(`${trimmedTitle} ${trimmedContext}`);
  const isPerson = isPersonContext(trimmedContext);

  const fetchImageInfo = async (fileTitle: string): Promise<string | null> => {
    const apis = [
      `https://commons.wikimedia.org/w/api.php`,
      `https://en.wikipedia.org/w/api.php`
    ];
    for (const api of apis) {
      try {
        const url = `${api}?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=800&origin=*`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
        if (!resp.ok) continue;
        const data = await resp.json();
        const pagesInfo = data?.query?.pages;
        const imgPage = pagesInfo ? (Object.values(pagesInfo)[0] as any) : null;
        const info = imgPage?.imageinfo?.[0];
        if (info?.thumburl || info?.url) return info.thumburl || info.url;
      } catch { }
    }
    return null;
  };

  const resolveWikidataId = async (allowSearchFallback: boolean): Promise<string | null> => {
    try {
      const ppUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(trimmedTitle)}&redirects=1&origin=*`;
      const ppRes = await fetch(ppUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
      if (!ppRes.ok) {
        console.warn("[Image][Wikidata] pageprops status", ppRes.status);
      }
      const ppData = await ppRes.json();
      const pages = ppData?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      const qid = page?.pageprops?.wikibase_item;
      if (qid && /^Q\d+$/.test(qid)) return qid;
      console.warn("[Image][Wikidata] no qid from pageprops", trimmedTitle);
    } catch (e) {
      console.warn("[Image][Wikidata] pageprops failed", trimmedTitle, e);
    }

    if (allowSearchFallback) {
      try {
        const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&search=${encodeURIComponent(trimmedTitle)}&origin=*`;
        const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
        const data = await res.json();
        const id = data?.search?.[0]?.id;
        if (id && /^Q\d+$/.test(id)) return id;
        console.warn("[Image][Wikidata] search found nothing", trimmedTitle);
      } catch (e) {
        console.warn("[Image][Wikidata] search failed", trimmedTitle, e);
      }
    }
    return null;
  };

  const fetchWikidataImageForTitle = async (allowSearchFallback: boolean): Promise<string | null> => {
    try {
      const qid = await resolveWikidataId(allowSearchFallback);
      if (!qid) return null;
      const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qid}&origin=*`;
      const wdRes = await fetch(wdUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
      if (!wdRes.ok) console.warn("[Image][Wikidata] wbgetentities status", wdRes.status);
      const wdData = await wdRes.json();
      const claims = wdData?.entities?.[qid]?.claims;
      const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
      if (!p18) return null;
      const imgTitle = p18.startsWith('File:') ? p18 : `File:${p18}`;
      return fetchImageInfo(imgTitle);
    } catch (e) {
      console.warn("[Image][Wikidata] failed", trimmedTitle, e);
      return null;
    }
  };

  const fetchWikipediaPageImage = async (): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(trimmedTitle)}&pithumbsize=800&redirects=1&origin=*`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
      if (!resp.ok) return null;
      const data = await resp.json();
      const pages = data?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      return page?.thumbnail?.source || null;
    } catch {
      return null;
    }
  };

  const fetchWikipediaExtract = async (): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(trimmedTitle)}&redirects=1&origin=*`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
      if (!resp.ok) return null;
      const data = await resp.json();
      const pages = data?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      return page?.extract || null;
    } catch {
      return null;
    }
  };

  const fetchWikipediaPosterFromImages = async (): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&titles=${encodeURIComponent(trimmedTitle)}&imlimit=50&redirects=1&origin=*`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
      if (!resp.ok) return null;
      const data = await resp.json();
      const pages = data?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      const images = page?.images || [];
      if (!images.length) return null;

      const normalizedTitle = trimmedTitle.toLowerCase();
      const candidates = images
        .map((img: any) => String(img?.title || ''))
        .filter((t: string) => t.toLowerCase().startsWith('file:'));

      if (!candidates.length) return null;

      const scored = candidates.map((t: string) => {
        const lt = t.toLowerCase();
        let score = 0;
        if (lt.includes('poster')) score += 500;
        if (lt.includes('cover')) score += 200;
        if (lt.includes('film') || lt.includes('movie')) score += 150;
        if (lt.includes(normalizedTitle)) score += 200;

        // Penalize junk keywords often found in museum/car photos
        const junk = ['museum', 'car', 'grill', 'packard', 'automobile', 'vehicle', 'display', 'engine', 'cockpit', 'interior', 'exterior', 'restoration', 'may_2017'];
        if (junk.some(j => lt.includes(j))) score -= 1000;

        // Movie posters usually have clean filenames. Long, descriptive names often imply a photo OF a prop.
        if (t.length > 100) score -= 400;

        if (lt.includes('.svg') || lt.includes('.webm') || lt.includes('.gif')) score -= 300;
        return { title: t, score };
      }).sort((a: any, b: any) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score <= 0) {
        console.warn(`[Image][Wiki-Poster] No good poster found for "${trimmedTitle}". Best score: ${best?.score || 0}`);
        return null;
      }
      return fetchImageInfo(best.title);
    } catch {
      return null;
    }
  };

  const fetchCommonsPoster = async (): Promise<string | null> => {
    try {
      const searchQuery = `"${trimmedTitle}" poster`;
      const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srnamespace=6&srlimit=5&origin=*`;
      const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
      const data = await res.json();
      const hits: any[] = data?.query?.search || [];
      let best: { url: string; score: number; title: string } | null = null;
      const normalizedTitle = trimmedTitle.toLowerCase();
      for (const h of hits) {
        const fileTitle = h?.title;
        if (!fileTitle) continue;
        const lowerTitle = String(fileTitle).toLowerCase();
        if (lowerTitle.endsWith('.pdf') || lowerTitle.includes('.pdf/')) continue;
        const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url|size&iiurlwidth=800&origin=*`;
        const infoRes = await fetch(infoUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
        const infoData = await infoRes.json();
        const pages = infoData?.query?.pages;
        const page = pages ? (Object.values(pages)[0] as any) : null;
        const info = page?.imageinfo?.[0];
        const url = info?.thumburl || info?.url;
        if (!url) continue;
        const w = Number(info?.thumbwidth || info?.width || 0);
        const hgt = Number(info?.thumbheight || info?.height || 0);
        const ratio = hgt > 0 && w > 0 ? hgt / w : 0;
        let score = 0;
        const lt = String(fileTitle).toLowerCase();
        if (lt.includes(normalizedTitle)) score += 180;
        if (lt.includes('poster')) score += 120;
        if (lt.includes('season')) score += 40;
        if (ratio > 1.2) score += 60;
        if (ratio < 0.9) score -= 150;
        if (w < 300 || hgt < 400) score -= 80;
        if (score <= 0) score = 10;
        if (!best || score > best.score) best = { url, score, title: fileTitle };
      }
      return best?.url || null;
    } catch {
      return null;
    }
  };

  const fetchCommonsPortrait = async (): Promise<string | null> => {
    try {
      const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(trimmedTitle)}&srnamespace=6&srlimit=10&origin=*`;
      const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Constellations/1.0' } });
      const data = await res.json();
      const hits: any[] = data?.query?.search || [];
      if (!hits.length) return null;
      const baseWords = trimmedTitle.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const scored = hits.map(h => {
        const fileTitle = String(h?.title || '');
        const lt = fileTitle.toLowerCase();
        if (!lt.startsWith('file:')) return { title: fileTitle, score: -1000 };
        let score = 0;
        if (lt.includes('portrait') || lt.includes('photo') || lt.includes('headshot') || lt.includes('face')) score += 350;
        if (lt.includes('poster')) score -= 200;
        if (lt.includes('with') || lt.includes(' and ') || lt.includes(' group')) score -= 250;
        const matches = baseWords.filter(w => lt.includes(w));
        if (matches.length < Math.min(2, baseWords.length)) score -= 400;
        score += (matches.length / Math.max(1, baseWords.length)) * 500;
        if (lt.includes('.jpg') || lt.includes('.jpeg')) score += 100;
        if (lt.includes('.png')) score -= 20;
        if (lt.includes('.svg') || lt.includes('.webm') || lt.includes('.gif')) score -= 300;
        const wordCount = lt.split(/[^a-z]/).filter(w => w.length > 2).length;
        score -= wordCount * 15;
        return { title: fileTitle, score };
      }).sort((a: any, b: any) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score <= 0) return null;
      return fetchImageInfo(best.title);
    } catch {
      return null;
    }
  };

  if (trimmedTitle.toLowerCase().startsWith('file:') || trimmedTitle.toLowerCase().startsWith('image:')) {
    const fileUrl = await fetchImageInfo(trimmedTitle);
    return { url: fileUrl, source: fileUrl ? "file" : "file-miss" };
  }

  if (!isScreenWork && !isPerson) {
    const extract = await fetchWikipediaExtract();
    if (extract && looksLikeScreenWork(extract)) {
      isScreenWork = true;
    }
  }

  if (isPerson) {
    const fromPageImage = await fetchWikipediaPageImage();
    if (fromPageImage) return { url: fromPageImage, source: "pageimage" };
    const fromWikidata = await fetchWikidataImageForTitle(false);
    if (fromWikidata) return { url: fromWikidata, source: "wikidata" };
    const fromCommons = await fetchCommonsPortrait();
    if (fromCommons) return { url: fromCommons, source: "commons-portrait" };
    return { url: null };
  }

  if (isScreenWork) {
    const fromEnwikiPoster = await fetchWikipediaPosterFromImages();
    if (fromEnwikiPoster) return { url: fromEnwikiPoster, source: "enwiki-images" };
    const fromCommons = await fetchCommonsPoster();
    if (fromCommons) return { url: fromCommons, source: "commons" };
    const fromWikidata = await fetchWikidataImageForTitle(false);
    if (fromWikidata) return { url: fromWikidata, source: "wikidata" };
    const fromPageImage = await fetchWikipediaPageImage();
    if (fromPageImage) return { url: fromPageImage, source: "pageimage" };
    const fromDdg = await fetchPosterFromDuckDuckGo(trimmedTitle);
    if (fromDdg) return { url: fromDdg, source: "ddg" };
    return { url: null };
  }

  const fromWikidata = await fetchWikidataImageForTitle(true);
  if (fromWikidata) return { url: fromWikidata, source: "wikidata" };
  const fromPageImage = await fetchWikipediaPageImage();
  if (fromPageImage) return { url: fromPageImage, source: "pageimage" };
  const fromCommons = await fetchCommonsPoster();
  if (fromCommons) return { url: fromCommons, source: "commons" };
  const fromDdg = await fetchPosterFromDuckDuckGo(trimmedTitle);
  if (fromDdg) return { url: fromDdg, source: "ddg" };
  return { url: null };
};

app.get("/api/image", async (req, res) => {
  const title = String(req.query.title || "").trim();
  const context = String(req.query.context || "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  console.log(`[Image] request`, { title, context });
  try {
    const result = await resolveImageForTitle(title, context);
    return res.status(200).json(result);
  } catch (e: any) {
    console.warn("[Image] error for", title, e);
    return res.status(500).json({ error: e?.message || "image fetch failed" });
  }
});

// Poster proxy endpoint (alias to /api/image).
app.get("/api/poster", async (req, res) => {
  const title = String(req.query.title || "").trim();
  const context = String(req.query.context || "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  console.log(`[Poster] request`, { title, context });
  try {
    const result = await resolveImageForTitle(title, context);
    return res.status(200).json(result);
  } catch (e: any) {
    console.warn("[Poster] error for", title, e);
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

// --- AI Proxy Endpoints ---

/** Send 200 + JSON without using res.json (avoids Express passing stringify errors to the global 500 handler). */
function sendAiJson(res: express.Response, payload: unknown, fallbackBody: string) {
  try {
    if (res.headersSent) return;
    res.status(200).type("application/json").send(JSON.stringify(payload));
  } catch (e) {
    console.error("[sendAiJson] stringify failed; sending fallback", e);
    if (!res.headersSent) {
      res.status(200).type("application/json").send(fallbackBody);
    }
  }
}

app.post("/api/ai/classify-start", async (req, res) => {
  const { term, wikiContext } = req.body;
  if (!term) return res.status(400).json({ error: "term is required" });
  console.log(`📡 [Proxy] Classify-Start: "${term}"`);
  const fallback = defaultStartPairResult(
    "Classification service error; defaulting to Person↔Event."
  );
  try {
    const result = await classifyStartPair(term, wikiContext);
    console.log(`✅ [Proxy] Classify-Start result for "${term}":`, result);
    sendAiJson(res, result, JSON.stringify(fallback));
  } catch (e: any) {
    console.error(`[Proxy] Classify-Start error for "${term}":`, e);
    sendAiJson(res, fallback, JSON.stringify(fallback));
  }
});

app.post("/api/ai/classify", async (req, res) => {
  const { term, wikiContext } = req.body;
  if (!term) return res.status(400).json({ error: "term is required" });
  console.log(`📡 [Proxy] Classify: "${term}"`);
  const fallback = { type: "Event", description: "", isAtomic: false };
  try {
    const result = await classifyEntity(term, wikiContext);
    console.log(`✅ [Proxy] Classify internal result for "${term}":`, result);
    sendAiJson(res, result, JSON.stringify(fallback));
  } catch (e: any) {
    console.error(`[Proxy] Classify error for "${term}":`, e);
    sendAiJson(res, fallback, JSON.stringify(fallback));
  }
});

app.post("/api/ai/connections", async (req, res) => {
  const { nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles } = req.body;
  if (!nodeName) return res.status(400).json({ error: "nodeName is required" });
  console.log(`📡 [Proxy] Connections: "${nodeName}" (Type: ${compositeType})`);
  const empty = { people: [] };
  try {
    const result = await fetchConnections(nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles);
    console.log(`✅ [Proxy] Connections internal result for "${nodeName}":`, result.people?.length || 0, "people found");
    sendAiJson(res, result, '{"people":[]}');
  } catch (e: any) {
    console.error(`[Proxy] Connections error for "${nodeName}":`, e);
    sendAiJson(res, empty, '{"people":[]}');
  }
});

app.post("/api/ai/works", async (req, res) => {
  const { nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles } = req.body;
  if (!nodeName) return res.status(400).json({ error: "nodeName is required" });
  console.log(`📡 [Proxy] Works: "${nodeName}" (Type: ${atomicType})`);
  const empty = { works: [] };
  try {
    const result = await fetchPersonWorks(nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles);
    console.log(`✅ [Proxy] Works result for "${nodeName}":`, result.works?.length || 0, "works found");
    sendAiJson(res, result, '{"works":[]}');
  } catch (e: any) {
    console.error(`[Proxy] Works error for "${nodeName}":`, e);
    sendAiJson(res, empty, '{"works":[]}');
  }
});

app.post("/api/ai/path", async (req, res) => {
  const { start, end, context } = req.body;
  if (!start || !end) return res.status(400).json({ error: "start and end are required" });
  const empty = { path: [], found: false };
  try {
    const result = await fetchConnectionPath(start, end, context);
    sendAiJson(res, result, '{"path":[],"found":false}');
  } catch (e: any) {
    console.error(`[Proxy] Path error:`, e);
    sendAiJson(res, empty, '{"path":[],"found":false}');
  }
});

app.post("/api/ai/title", async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const result = await findWikipediaTitle(name, description);
    sendAiJson(res, result, "null");
  } catch (e: any) {
    console.error(`[Proxy] Title error for "${name}":`, e);
    sendAiJson(res, null, "null");
  }
});

app.post("/api/ai/search-org", async (req, res) => {
  const { orgName } = req.body;
  if (!orgName) return res.status(400).json({ error: "orgName is required" });
  try {
    const result = await fetchOrgKeyPeopleBlockViaSearch(orgName);
    sendAiJson(res, result, "null");
  } catch (e: any) {
    console.error(`[Proxy] search-org error:`, e);
    sendAiJson(res, null, "null");
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  const prov = getLlmProvider();
  const hasKey =
    prov === "gemini"
      ? Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY)
      : prov === "openai"
        ? Boolean(process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY)
        : prov === "deepseek"
          ? Boolean(process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY)
          : Boolean(process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY);
  const hasGemini429Fallback = Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.VITE_OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.VITE_DEEPSEEK_API_KEY
  );
  console.log(
    `Cache server listening on ${port} (LLM_PROVIDER=${process.env.LLM_PROVIDER ?? "unset"} → effective ${prov}, primary key: ${hasKey ? "set" : "missing"}; ${prov === "gemini" ? `429 fallback keys: ${hasGemini429Fallback ? "set" : "missing"}` : "—"})`
  );
});
