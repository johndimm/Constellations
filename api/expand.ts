import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_helpers";
import { fetchConnections, fetchPersonWorks, classifyEntity } from "../services/aiService";
import { fetchWikipediaSummary } from "../services/wikipediaService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const { query, context, atomicType, compositeType } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const wiki = await fetchWikipediaSummary(query, context);
    let isAtomic = (atomicType || "").toLowerCase() === "person";
    let type = atomicType;

    if (!type) {
      const classification = await classifyEntity(query, wiki.extract || undefined);
      isAtomic = classification.isAtomic;
      type = classification.type;
    }

    let data;
    if (isAtomic) {
      data = await fetchPersonWorks(query, [], wiki.extract || undefined, wiki.pageid?.toString(), atomicType, compositeType, wiki.mentioningPageTitles || undefined);
    } else {
      data = await fetchConnections(query, context, [], wiki.extract || undefined, wiki.pageid?.toString(), atomicType, compositeType, wiki.mentioningPageTitles || undefined);
    }

    return res.json({ query, wiki, type, isAtomic, data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
