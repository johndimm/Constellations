import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

export function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const useSsl = process.env.PGSSLMODE !== "disable";
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return pool;
}

let NODE_ATOMIC_COL: "is_atomic" | "is_person" | null = null;

async function getNodeAtomicCol(
  client: pg.PoolClient
): Promise<"is_atomic" | "is_person" | null> {
  if (NODE_ATOMIC_COL) return NODE_ATOMIC_COL;
  try {
    const colsRes = await client.query(
      `select column_name from information_schema.columns where table_name = 'nodes' and column_name in ('is_atomic','is_person')`
    );
    const cols = new Set(colsRes.rows.map((r: any) => r.column_name));
    if (cols.has("is_atomic")) NODE_ATOMIC_COL = "is_atomic";
    else if (cols.has("is_person")) NODE_ATOMIC_COL = "is_person";
    else NODE_ATOMIC_COL = null;
  } catch {
    NODE_ATOMIC_COL = null;
  }
  return NODE_ATOMIC_COL;
}

export async function upsertNodes(
  client: pg.PoolClient,
  nodes: any[]
): Promise<Map<string, any>> {
  if (!nodes.length) return new Map();

  const nodeMap = new Map<string, any>();
  const atomicCol = await getNodeAtomicCol(client);

  for (const n of nodes) {
    const meta = n.meta || {};
    const wikiId = (n.wikipedia_id || n.wikipediaId || "").toString().trim();
    const normalizedWikiId = wikiId || "";
    const imageUrl = meta.imageUrl || n.imageUrl || n.image_url || null;
    const wikiSummary = meta.wikiSummary || n.wikiSummary || n.wiki_summary || null;
    try {
      const title = n.title || n.id;

      const wikiRes = normalizedWikiId
        ? await client.query(
            `select id, type, wikipedia_id from nodes where COALESCE(wikipedia_id, '') = $1 limit 1`,
            [normalizedWikiId]
          )
        : { rows: [] as any[] };

      const exactRes =
        normalizedWikiId && wikiRes.rows.length === 0
          ? await client.query(
              `select id, type, wikipedia_id from nodes
               where lower(title) = lower($1) and lower(type) = lower($2) and COALESCE(wikipedia_id, '') = $3
               order by id limit 1`,
              [title, n.type, normalizedWikiId]
            )
          : { rows: [] as any[] };

      const fuzzyRes =
        wikiRes.rows.length === 0 && exactRes.rows.length === 0
          ? await client.query(
              `select id, type, wikipedia_id from nodes
               where lower(title) = lower($1) and lower(type) = lower($2)
               order by case when wikipedia_id is not null and wikipedia_id != '' then 0 else 1 end, id
               limit 1`,
              [title, n.type]
            )
          : { rows: [] as any[] };

      let row;
      const matchRow = wikiRes.rows[0] || exactRes.rows[0] || fuzzyRes.rows[0];

      if (matchRow) {
        const matchId = matchRow.id;
        const existingType = matchRow.type;
        const existingWiki = matchRow.wikipedia_id || "";
        const typeToKeep =
          existingType && existingType !== existingType.toLowerCase()
            ? existingType
            : n.type;
        const wikiToKeep = existingWiki || normalizedWikiId || "";
        const isAtomicToKeep =
          n.is_atomic !== undefined
            ? !!n.is_atomic
            : n.is_person !== undefined
              ? !!n.is_person
              : typeToKeep && typeToKeep.toLowerCase() === "person";

        if (atomicCol) {
          const updateRes = await client.query(
            `update nodes set
               type = $1, description = coalesce($2, description), year = coalesce($3, year),
               meta = coalesce(meta, '{}'::jsonb) || coalesce($4, '{}'::jsonb),
               image_url = coalesce($5, image_url), wiki_summary = coalesce($6, wiki_summary),
               wikipedia_id = $8, ${atomicCol} = $9, updated_at = now()
             where id = $7 returning *`,
            [typeToKeep, n.description ?? null, n.year ?? null, meta, imageUrl, wikiSummary, matchId, wikiToKeep, isAtomicToKeep]
          );
          row = updateRes.rows[0];
        } else {
          const updateRes = await client.query(
            `update nodes set
               type = $1, description = coalesce($2, description), year = coalesce($3, year),
               meta = coalesce(meta, '{}'::jsonb) || coalesce($4, '{}'::jsonb),
               image_url = coalesce($5, image_url), wiki_summary = coalesce($6, wiki_summary),
               wikipedia_id = $8, updated_at = now()
             where id = $7 returning *`,
            [typeToKeep, n.description ?? null, n.year ?? null, meta, imageUrl, wikiSummary, matchId, wikiToKeep]
          );
          row = updateRes.rows[0];
        }
      } else {
        const isAtomic =
          n.is_atomic !== undefined
            ? !!n.is_atomic
            : n.is_person !== undefined
              ? !!n.is_person
              : n.type && n.type.toLowerCase() === "person";

        const insertFields = atomicCol
          ? `title, type, description, year, meta, wikipedia_id, image_url, wiki_summary, ${atomicCol}`
          : `title, type, description, year, meta, wikipedia_id, image_url, wiki_summary`;
        const insertPlaceholders = atomicCol
          ? `$1, $2, $3, $4, $5, $6, $7, $8, $9`
          : `$1, $2, $3, $4, $5, $6, $7, $8`;
        const insertParams = atomicCol
          ? [title, n.type, n.description ?? null, n.year ?? null, meta, normalizedWikiId, imageUrl, wikiSummary, isAtomic]
          : [title, n.type, n.description ?? null, n.year ?? null, meta, normalizedWikiId, imageUrl, wikiSummary];

        await client.query("savepoint upsert_node");
        try {
          const insertRes = await client.query(
            `insert into nodes (${insertFields}) values (${insertPlaceholders}) returning *`,
            insertParams
          );
          row = insertRes.rows[0];
          await client.query("release savepoint upsert_node");
        } catch (insertErr: any) {
          await client.query("rollback to savepoint upsert_node");
          if (insertErr.code === "23505") {
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
        const key = `${normalizedWikiId}|${(n.title || n.id || "").toString().toLowerCase()}|${(n.type || "").toString().toLowerCase()}`;
        nodeMap.set(key, {
          ...row,
          imageUrl: row.image_url,
          wikiSummary: row.wiki_summary,
          is_atomic: row.is_atomic ?? row.type?.toLowerCase() === "person",
        });
      }
    } catch (e: any) {
      console.error("Upsert failed for node", n.title, e.message);
      throw e;
    }
  }
  return nodeMap;
}

export async function upsertEdge(
  client: pg.PoolClient,
  atomicId: number,
  compositeId: number,
  label?: string,
  meta?: any
) {
  await client.query(
    `insert into edges (atomic_id, composite_id, label, meta)
     values ($1, $2, $3, $4)
     on conflict (atomic_id, composite_id) do update
     set label = coalesce(excluded.label, edges.label),
         meta = coalesce(edges.meta, '{}'::jsonb) || coalesce(excluded.meta, '{}'::jsonb),
         updated_at = now()`,
    [atomicId, compositeId, label || null, meta || {}]
  );
}

export const initSql = `
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
create table if not exists classify_cache (
  term text primary key,
  result jsonb not null,
  updated_at timestamptz default now()
);
`;
