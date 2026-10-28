import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, applyProviderFromRequest } from "../_helpers";
import { fetchConnectionPath } from "../../services/aiService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  applyProviderFromRequest(req.body);
  const { start, end, context } = req.body || {};
  if (!start || !end) return res.status(400).json({ error: "start and end are required" });
  try {
    const result = await fetchConnectionPath(start, end, context);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
