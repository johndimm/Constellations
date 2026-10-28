import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, applyProviderFromRequest } from "../_helpers";
import { fetchConnections } from "../../services/aiService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  applyProviderFromRequest(req.body);
  const { nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles } = req.body || {};
  if (!nodeName) return res.status(400).json({ error: "nodeName is required" });
  try {
    const result = await fetchConnections(nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
