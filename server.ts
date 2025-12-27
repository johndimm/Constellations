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
    // Check for schema mismatch
    let needsRecreate = false;
    try {
      await client.query("select person_id from edges limit 1");
      console.log("Column 'person_id' exists.");
    } catch (e: any) {
      console.log("Column 'person_id' missing or table 'edges' missing. Recreating schema.");
      needsRecreate = true;
    }
    if (!needsRecreate) {
      try {
        await client.query("select image_url from nodes limit 1");
      } catch (e: any) {
        console.log("Column 'image_url' missing. Recreating schema.");
        needsRecreate = true;
      }
    }

    if (needsRecreate) {
      console.log("Dropping old tables...");
      await client.query("drop table if exists edges cascade");
      await client.query("drop table if exists nodes cascade");
      await client.query(initSql);
      console.log("Schema recreated successfully.");
    } else {
      // Even if person_id exists, ensure other tables/indexes are there
      await client.query(initSql);
      console.log("Schema is up to date.");
    }
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
  wikipedia_id text,
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
`;

// Upsert nodes batch and return mapping of (title, type, wikipedia_id) -> id
async function upsertNodes(client: pg.PoolClient, nodes: any[]): Promise<Map<string, number>> {
  if (!nodes.length) return new Map();
  
  const idMap = new Map<string, number>();
  
  for (const n of nodes) {
    const meta = n.meta || {};
    const imageUrl = meta.imageUrl || n.imageUrl || n.image_url || null;
    const wikiSummary = meta.wikiSummary || n.wikiSummary || n.wiki_summary || null;
    const sql = `
      insert into nodes (title, type, description, year, meta, wikipedia_id, image_url, wiki_summary)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (title, type, wikipedia_id) do update
      set description = coalesce(excluded.description, nodes.description),
          year = coalesce(excluded.year, nodes.year),
          meta = coalesce(nodes.meta, '{}'::jsonb) || coalesce(excluded.meta, '{}'::jsonb),
          image_url = coalesce(excluded.image_url, nodes.image_url),
          wiki_summary = coalesce(excluded.wiki_summary, nodes.wiki_summary),
          updated_at = now()
      returning id;
    `;
    const res = await client.query(sql, [
      n.title || n.id, // n.id might be the title in old code
      n.type,
      n.description ?? null,
      n.year ?? null,
      meta,
      n.wikipedia_id ?? null,
      imageUrl,
      wikiSummary
    ]);
    const key = `${n.title || n.id}|${n.type}|${n.wikipedia_id || ''}`;
    idMap.set(key, res.rows[0].id);
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
