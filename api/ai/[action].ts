import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, applyProviderFromRequest } from "../_helpers";
import {
  classifyStartPair,
  classifyEntity,
  fetchConnections,
  fetchPersonWorks,
  fetchConnectionPath,
  findWikipediaTitle,
  fetchOrgKeyPeopleBlockViaSearch,
  sanitizeSearchTerm,
} from "../../services/aiService";
import { resolveStartSearchTerm } from "../../services/geminiService";
import { getOpenAiCompatConfig } from "../../services/aiUtils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const action = String(req.query.action || "");

  switch (action) {
    case "classify-start":
      return classifyStartHandler(req, res);
    case "classify":
      return classifyHandler(req, res);
    case "connections":
      return connectionsHandler(req, res);
    case "works":
      return worksHandler(req, res);
    case "path":
      return pathHandler(req, res);
    case "title":
      return titleHandler(req, res);
    case "search-org":
      return searchOrgHandler(req, res);
    case "openai-ping":
      return openaiPingHandler(req, res);
    default:
      return res.status(404).json({ error: `Unknown AI action: ${action}` });
  }
}

async function classifyStartHandler(req: VercelRequest, res: VercelResponse) {
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

async function classifyHandler(req: VercelRequest, res: VercelResponse) {
  applyProviderFromRequest(req.body);
  const raw = req.body?.term;
  if (!raw) return res.status(400).json({ error: "term is required" });
  const term = sanitizeSearchTerm(raw);
  try {
    const result = await classifyEntity(term, req.body.wikiContext);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

async function connectionsHandler(req: VercelRequest, res: VercelResponse) {
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

async function worksHandler(req: VercelRequest, res: VercelResponse) {
  applyProviderFromRequest(req.body);
  const { nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles } = req.body || {};
  if (!nodeName) return res.status(400).json({ error: "nodeName is required" });
  try {
    const result = await fetchPersonWorks(nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

async function pathHandler(req: VercelRequest, res: VercelResponse) {
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

async function titleHandler(req: VercelRequest, res: VercelResponse) {
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

async function searchOrgHandler(req: VercelRequest, res: VercelResponse) {
  const { orgName } = req.body || {};
  if (!orgName) return res.status(400).json({ error: "orgName is required" });
  try {
    const result = await fetchOrgKeyPeopleBlockViaSearch(orgName);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

async function openaiPingHandler(req: VercelRequest, res: VercelResponse) {
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
