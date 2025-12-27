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

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(bodyParser.json());

// Helpers
const sha1 = (val: string) => crypto.createHash("sha1").update(val).digest("hex");

// Schema initializer (run once manually or call this endpoint once)
const initSql = `
create table if not exists nodes (
  id text primary key,
  type text not null,
  description text,
  year int,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists edges (
  source_id text not null references nodes(id) on delete cascade,
  targets text[] not null,
  context_fingerprint text not null,
  context_ids text[] not null default '{}',
  updated_at timestamptz default now(),
  primary key (source_id, context_fingerprint)
);

create index if not exists edges_targets_gin on edges using gin (targets);
alter table edges add column if not exists context_ids text[] not null default '{}';
`;

// Upsert nodes batch
async function upsertNodes(client: pg.PoolClient, nodes: any[]) {
  if (!nodes.length) return;
  const values = nodes.map((n, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`).join(",");
  const params: any[] = [];
  nodes.forEach(n => {
    params.push(n.id, n.type, n.description ?? null, n.year ?? null, n.meta ?? {});
  });
  const sql = `
    insert into nodes (id, type, description, year, meta)
    values ${values}
    on conflict (id) do update
    set type = excluded.type,
        description = coalesce(excluded.description, nodes.description),
        year = coalesce(excluded.year, nodes.year),
        meta = nodes.meta || excluded.meta,
        updated_at = now();
  `;
  await client.query(sql, params);
}

async function upsertEdge(client: pg.PoolClient, source_id: string, targets: string[], context_fingerprint: string, context_ids: string[]) {
  await client.query(
    `
      insert into edges (source_id, targets, context_fingerprint, context_ids)
      values ($1, $2, $3, $4)
      on conflict (source_id, context_fingerprint) do update
      set targets = excluded.targets, context_ids = excluded.context_ids, updated_at = now();
    `,
    [source_id, targets, context_fingerprint, context_ids]
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  const inter = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : inter.size / union.size;
}

// Routes
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/init", async (_, res) => {
  const client = await pool.connect();
  try {
    await client.query(initSql);
    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Fetch expansion: exact first, then optional partial
app.get("/expansion", async (req, res) => {
  const { sourceId, contextHash, minSimilarity, context } = req.query as { sourceId?: string; contextHash?: string; minSimilarity?: string; context?: string };
  if (!sourceId) return res.status(400).json({ error: "sourceId required" });
  const minSim = minSimilarity ? parseFloat(minSimilarity) : 0.5;
  const contextList = context ? context.split(",").filter(Boolean) : [];
  const requestedSet = new Set(contextList);
  const client = await pool.connect();
  try {
    const exact = await client.query(
      `select targets, context_fingerprint, context_ids from edges where source_id = $1 and context_fingerprint = $2`,
      [sourceId, contextHash || ""]
    );
    if (exact.rowCount) {
      const targets: string[] = exact.rows[0].targets;
      const nodes = await client.query(`select * from nodes where id = any($1)`, [targets]);
      return res.json({ hit: "exact", targets, nodes: nodes.rows });
    }

    // Partial reuse: fetch all expansions for this source and pick the best overlap
    const all = await client.query(`select targets, context_fingerprint, context_ids from edges where source_id = $1`, [sourceId]);
    let best: any = null;
    for (const row of all.rows) {
      const ctxIds = new Set((row.context_ids as string[]) || []);
      const score = jaccard(requestedSet, ctxIds);
      if (!best || score > best.score) best = { row, score };
    }
    if (best && best.score >= minSim) {
      const targets: string[] = best.row.targets;
      const nodes = await client.query(`select * from nodes where id = any($1)`, [targets]);
      return res.json({ hit: "partial", score: best.score, targets, nodes: nodes.rows });
    }

    return res.json({ hit: "miss" });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Save expansion (overwrite for this context)
app.post("/expansion", async (req, res) => {
  const { sourceId, context, targets, nodes } = req.body as {
    sourceId: string;
    context: string[]; // neighbor ids used in prompt
    targets: string[]; // returned neighbors
    nodes: any[];      // nodes to upsert
  };
  if (!sourceId || !targets) return res.status(400).json({ error: "sourceId and targets required" });
  const contextFingerprint = sha1((context || []).slice().sort().join("|"));
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertNodes(client, nodes || []);
    await upsertEdge(client, sourceId, targets, contextFingerprint, (context || []).slice().sort());
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

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Cache server listening on ${port}`);
});
