import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_helpers";
import { getOpenAiCompatConfig } from "../../services/aiUtils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  try {
    const { apiKey, baseUrl, headers } = getOpenAiCompatConfig();
    if (!apiKey) {
      return res.status(400).json({ ok: false, error: "No OpenAI API key in server env" });
    }
    const pingHeaders: Record<string, string> = { Authorization: headers.Authorization };
    if (headers["OpenAI-Organization"]) pingHeaders["OpenAI-Organization"] = headers["OpenAI-Organization"];
    if (headers["OpenAI-Project"]) pingHeaders["OpenAI-Project"] = headers["OpenAI-Project"];
    const r = await fetch(`${baseUrl}/models`, { headers: pingHeaders });
    const body = await r.text();
    return res.status(r.ok ? 200 : r.status).json({
      ok: r.ok,
      baseUrl,
      keyLen: apiKey.length,
      keySuffix: apiKey.slice(-4),
      openaiStatus: r.status,
      openaiBody: body.slice(0, 500),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "ping failed" });
  }
}
