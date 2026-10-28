import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { fetchDuckDuckGoImages } from "../services/resolveImageForTitle";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const q = String(req.query.title || req.query.q || "").trim();
  const limit = Number(req.query.limit || 10);
  if (!q) return res.status(400).json({ error: "title (or q) is required" });
  const results = await fetchDuckDuckGoImages(q, isNaN(limit) ? 10 : limit);
  return res.json({ query: q, count: results.length, results });
}
