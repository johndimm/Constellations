import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_helpers";
import { getPool } from "../_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const name = String(req.query.name || "");
  if (!name) return res.status(400).json({ error: "name required" });

  if (req.method === "GET") return handleGet(name, res);
  if (req.method === "DELETE") return handleDelete(name, res);
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(name: string, res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query("select data from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    return res.json(result.rows[0].data);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function handleDelete(name: string, res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query("delete from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
