import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, applyProviderFromRequest } from "../_helpers";
import { classifyStartPair, sanitizeSearchTerm } from "../../services/aiService";
import { resolveStartSearchTerm } from "../../services/geminiService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  applyProviderFromRequest(req.body);
  const raw = req.body?.term;
  if (!raw) return res.status(400).json({ error: "term is required" });
  const sanitized = sanitizeSearchTerm(raw);
  const term = await resolveStartSearchTerm(sanitized);
  try {
    const result = await classifyStartPair(term, req.body.wikiContext);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
