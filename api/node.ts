import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { getPool, upsertNodes } from "./_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const node = req.body as { title?: string; type?: string; description?: string | null; year?: number | null; meta?: any; wikipedia_id?: string };
  if (!node?.title && !(node as any)?.id) return res.status(400).json({ error: "title required" });
  if (!node?.type) return res.status(400).json({ error: "type required" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const nodeMap = await upsertNodes(client, [{
      title: node.title || (node as any).id,
      type: node.type,
      description: node.description ?? null,
      year: node.year ?? null,
      meta: node.meta ?? {},
      wikipedia_id: node.wikipedia_id ?? null,
    }]);
    await client.query("COMMIT");

    const title = node.title || (node as any).id || "";
    const type = node.type || "";
    const wikiId = (node.wikipedia_id || "").toString().trim();
    const key = `${wikiId}|${title.toLowerCase()}|${type.toLowerCase()}`;
    const dbNode = nodeMap.get(key);
    return res.json({ ok: true, id: dbNode?.id, ...dbNode });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
