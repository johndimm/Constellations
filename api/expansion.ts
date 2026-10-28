import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { getPool, upsertNodes, upsertEdge } from "./_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const sourceId = String(req.query.sourceId || "");
  if (!sourceId) return res.status(400).json({ error: "sourceId required" });
  const id = parseInt(sourceId);
  if (isNaN(id)) return res.status(400).json({ error: "sourceId must be a number" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(
      `select n.*, e.label as edge_label, e.meta as edge_meta
       from nodes n
       join edges e on (
         (e.atomic_id = $1 and e.composite_id = n.id)
         or (e.composite_id = $1 and e.atomic_id = n.id)
       )
       where n.id != $1`,
      [id]
    );

    if (result.rowCount && result.rowCount > 0) {
      return res.json({
        hit: "exact",
        targets: result.rows.map((r: any) => r.id),
        nodes: result.rows.map((r: any) => {
          const m = r.meta || {};
          const mergedMeta = { ...m };
          if (!mergedMeta.imageUrl && r.image_url) mergedMeta.imageUrl = r.image_url;
          if (!mergedMeta.wikiSummary && r.wiki_summary) mergedMeta.wikiSummary = r.wiki_summary;
          return {
            ...r,
            meta: mergedMeta,
            imageUrl: r.image_url,
            wikiSummary: r.wiki_summary,
            is_atomic: r.is_atomic ?? r.type?.toLowerCase() === "person",
            is_person: r.is_atomic ?? r.type?.toLowerCase() === "person",
            edge_label: r.edge_label ?? null,
            edge_meta: r.edge_meta ?? null,
          };
        }),
      });
    }
    return res.json({ hit: "miss" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const { sourceId, nodes } = req.body || {};
  if (!sourceId || !nodes) return res.status(400).json({ error: "sourceId and nodes required" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const sourceRes = await client.query("select is_atomic, type from nodes where id = $1", [sourceId]);
    if (sourceRes.rowCount === 0) {
      await client.query("rollback");
      return res.json({ ok: true, skipped: true, reason: "source node not in db" });
    }
    const sourceIsAtomic = sourceRes.rows[0].is_atomic ?? sourceRes.rows[0].type?.toLowerCase() === "person";

    const nodeMap = await upsertNodes(client, nodes);

    for (const n of nodes) {
      const normalizedWikiId = (n.wikipedia_id || n.wikipediaId || "").toString().trim();
      const key = `${normalizedWikiId}|${(n.title || n.id || "").toString().toLowerCase()}|${(n.type || "").toString().toLowerCase()}`;
      const dbNode = nodeMap.get(key);
      if (!dbNode) continue;

      const targetId = dbNode.id;
      const [atomicId, compositeId] = sourceIsAtomic ? [sourceId, targetId] : [targetId, sourceId];
      await upsertEdge(client, atomicId, compositeId, n.edge_label || n.label, n.edge_meta || n.meta_edge);
    }

    await client.query("commit");
    return res.json({ ok: true });
  } catch (e: any) {
    await client.query("rollback").catch(() => {});
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
