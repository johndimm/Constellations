import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { getPool, initSql } from "./_db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("drop table if exists edges cascade");
    await client.query("drop table if exists nodes cascade");
    await client.query("drop table if exists saved_graphs cascade");
    await client.query(initSql);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
