import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_helpers";
import { fetchOrgKeyPeopleBlockViaSearch } from "../../services/aiService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const { orgName } = req.body || {};
  if (!orgName) return res.status(400).json({ error: "orgName is required" });
  try {
    const result = await fetchOrgKeyPeopleBlockViaSearch(orgName);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
