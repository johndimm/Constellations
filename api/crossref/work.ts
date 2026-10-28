import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_helpers";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const doiRaw = String(req.query.doi || "").trim();
  if (!doiRaw) return res.status(400).json({ error: "doi required" });
  const doi = doiRaw.replace(/^https?:\/\/doi\.org\//i, "");
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `Crossref error: ${r.status} ${r.statusText}`, body: text.slice(0, 2000) });
    }
    const json = await r.json();
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    return res.json(json);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Crossref request failed" });
  }
}
