import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_helpers";
import { getPool } from "../_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method === "GET") return handleGet(res);
  if (req.method === "POST") return handlePost(req, res);
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query("select name, updated_at from saved_graphs order by name asc");
    return res.json(result.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const { name, data } = req.body || {};
  if (!name || !data) return res.status(400).json({ error: "name and data required" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(
      `insert into saved_graphs (name, data, updated_at) values ($1, $2, now())
       on conflict (name) do update set data = excluded.data, updated_at = now()`,
      [name, data]
    );
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
