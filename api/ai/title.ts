import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, applyProviderFromRequest } from "../_helpers";
import { findWikipediaTitle } from "../../services/aiService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  applyProviderFromRequest(req.body);
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const result = await findWikipediaTitle(name, description);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
