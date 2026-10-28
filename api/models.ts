import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { fetchAllModels, fetchModelsForProvider } from "../services/modelsService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const provider = typeof req.query.provider === "string" ? req.query.provider : null;
  try {
    const models = provider ? await fetchModelsForProvider(provider) : await fetchAllModels();
    return res.json({ models });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "models fetch failed" });
  }
}
