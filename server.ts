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

// Ensure schema exists on startup (safe to run repeatedly).
async function ensureSchema() {
  const client = await pool.connect();
  try {
    // Check for schema mismatch (missing context_id)
    try {
      await client.query("select context_id from edges limit 1");
    } catch (e: any) {
      console.log("Schema check failed (likely missing column or table). Recreating schema.");
      await client.query("drop table if exists edges cascade");
    }

    await client.query(initSql);
    console.log("Schema ready.");
  } catch (e) {
    console.error("Schema init failed", e);
  } finally {
    client.release();
  }
}
ensureSchema();

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
  target_id text not null references nodes(id) on delete cascade,
  context_fingerprint text not null,
  context_ids text[] not null default '{}',
  context_id text references nodes(id) on delete set null,
  updated_at timestamptz default now(),
  primary key (source_id, target_id, context_fingerprint)
);

create index if not exists edges_source_idx on edges (source_id);
create index if not exists edges_target_idx on edges (target_id);
create index if not exists edges_context_idx on edges (context_id);
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
        meta = coalesce(nodes.meta, '{}'::jsonb) || coalesce(excluded.meta, '{}'::jsonb),
        updated_at = now();
  `;
  await client.query(sql, params);
}

async function upsertEdge(client: pg.PoolClient, source_id: string, targets: string[], context_fingerprint: string, context_ids: string[]) {
  if (!targets.length) return;
  // Upsert each edge individually
  // We want to avoid creating a massive single query string if targets is large, but batching is better than loop.
  // For standard expansion (size ~10), a single statement is fine.
  const values = targets.map((_, i) => `($1, $${i + 5}, $2, $3, $4)`).join(",");

  // Extract single context_id if available
  const context_id = context_ids.length === 1 ? context_ids[0] : null;

  // params: source_id, context_fingerprint, context_ids, context_id, t1, t2, t3...
  const params = [source_id, context_fingerprint, context_ids, context_id, ...targets];

  await client.query(
    `
      insert into edges (source_id, target_id, context_fingerprint, context_ids, context_id)
      values ${values}
      on conflict (source_id, target_id, context_fingerprint) do update
      set context_ids = excluded.context_ids, context_id = excluded.context_id, updated_at = now();
    `,
    params
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
    // Check for schema mismatch (missing context_id or old targets column) and drop if present
    try {
      const check = await client.query("select column_name from information_schema.columns where table_name='edges' and column_name='context_id'");
      if (check.rowCount === 0) {
        console.log("Old schema detected (missing context_id). Dropping 'edges' table.");
        await client.query("drop table edges cascade");
      } else {
        // Redundant check for very old schema (targets array) just in case
        await client.query("select targets from edges limit 1");
        console.log("Old schema detected (targets column). Dropping 'edges' table.");
        await client.query("drop table edges cascade");
      }
    } catch (ignore) { }

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
    // Fetch all edges for this source
    const result = await client.query(
      `select target_id, context_fingerprint, context_ids from edges where source_id = $1`,
      [sourceId]
    );

    // Group by context_fingerprint to verify sets
    const groups = new Map<string, { fingerprint: string, context_ids: string[], targets: string[] }>();
    result.rows.forEach(row => {
      if (!groups.has(row.context_fingerprint)) {
        groups.set(row.context_fingerprint, {
          fingerprint: row.context_fingerprint,
          context_ids: row.context_ids || [],
          targets: []
        });
      }
      groups.get(row.context_fingerprint)!.targets.push(row.target_id);
    });

    const entries = Array.from(groups.values());

    // 1. Exact match
    const exact = entries.find(g => g.fingerprint === contextHash);
    if (exact) {
      const nodes = await client.query(`select * from nodes where id = any($1)`, [exact.targets]);
      return res.json({ hit: "exact", targets: exact.targets, nodes: nodes.rows, matchedContext: exact.context_ids });
    }

    // 2. Partial reuse
    let best: any = null;
    for (const group of entries) {
      const ctxIds = new Set(group.context_ids);
      const score = jaccard(requestedSet, ctxIds);
      if (!best || score > best.score) best = { group, score };
    }
    const requestedHasContext = requestedSet.size > 0;
    // bestHasNoContext check: if matched context is empty, it's a generic expansion
    const bestHasNoContext = best && (!best.group.context_ids || best.group.context_ids.length === 0);

    if (best && (best.score >= minSim || (!requestedHasContext && bestHasNoContext) || bestHasNoContext)) {
      const targets: string[] = best.group.targets;
      const nodes = await client.query(`select * from nodes where id = any($1)`, [targets]);
      return res.json({ hit: "partial", score: best.score, targets, nodes: nodes.rows, matchedContext: best.group.context_ids });
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

// Upsert a single node (useful for late-arriving metadata like image URLs)
app.post("/node", async (req, res) => {
  const node = req.body as { id?: string; type?: string; description?: string | null; year?: number | null; meta?: any };
  if (!node.id) return res.status(400).json({ error: "id required" });
  if (!node.type) return res.status(400).json({ error: "type required" });
  const client = await pool.connect();
  try {
    await upsertNodes(client, [{
      id: node.id,
      type: node.type,
      description: node.description ?? null,
      year: node.year ?? null,
      meta: node.meta ?? {}
    }]);
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
