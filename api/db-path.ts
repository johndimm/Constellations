import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { getPool } from "./_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const startId = String(req.query.startId || "");
  const endId = String(req.query.endId || "");
  const maxDepth = parseInt(String(req.query.maxDepth || "10"));
  if (!startId || !endId) return res.status(400).json({ error: "startId and endId required" });

  const start = parseInt(startId);
  const end = parseInt(endId);
  if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: "startId and endId must be numbers" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    const visited = new Set<number>();
    const queue: Array<{ nodeId: number; path: number[] }> = [{ nodeId: start, path: [start] }];
    visited.add(start);

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      if (path.length > maxDepth) continue;

      const nodeRes = await client.query("select is_atomic from nodes where id = $1", [nodeId]);
      if (nodeRes.rows.length === 0) continue;
      const isAtomic = nodeRes.rows[0].is_atomic ?? false;

      const neighborsRes = await client.query(
        isAtomic
          ? `select composite_id as neighbor_id from edges where atomic_id = $1`
          : `select atomic_id as neighbor_id from edges where composite_id = $1`,
        [nodeId]
      );

      for (const row of neighborsRes.rows) {
        const neighborId = row.neighbor_id;
        if (neighborId === end) {
          const fullPath = [...path, neighborId];
          const nodesRes = await client.query(
            `select * from nodes where id = ANY($1::int[])`,
            [fullPath]
          );
          const nodeMap = new Map(nodesRes.rows.map((r: any) => [r.id, r]));
          const pathNodes = fullPath
            .map((id) => {
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
                is_atomic: node.is_atomic ?? node.type?.toLowerCase() === "person",
              };
            })
            .filter(Boolean);
          return res.json({ path: pathNodes, found: true });
        }
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ nodeId: neighborId, path: [...path, neighborId] });
        }
      }
    }
    return res.json({ path: [], found: false });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
