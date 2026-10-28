import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_helpers";
import { getPool } from "../_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const edgesResult = await client.query("DELETE FROM edges");
    const nodesResult = await client.query("DELETE FROM nodes");
    await client.query("COMMIT");
    return res.json({
      ok: true,
      message: "Cache cleared successfully",
      deleted: { nodes: nodesResult.rowCount || 0, edges: edgesResult.rowCount || 0 },
    });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
