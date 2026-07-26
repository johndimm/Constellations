"use client";
import { GeminiResponse, PersonWorksResponse, PathResponse } from "../types";
import { parseJsonFromModelText, withTimeout, withRetry, getEnvCacheUrl, readBundledEnv, readServerEnv, getLlmProvider, looksLikePersonName, getServerLlmModelOverride, getBrowserLlmModel, resolveAnthropicModel, getOpenAiCompatConfig, getDeepSeekApiKey, getAnthropicApiKey } from "./aiUtils";
import type { LockedPair } from "./geminiService";

export type { LockedPair };

const TIMEOUT_MS = 60000;
const CLASSIFY_TIMEOUT_MS = 15000;

let loggedProviderKeyDiag = new Set<string>();

function logProviderKeyOnce(provider: string, key: string) {
  if (typeof window !== "undefined") return;
  if (!key || loggedProviderKeyDiag.has(provider)) return;
  loggedProviderKeyDiag.add(provider);
  console.log(`[${provider}] API key loaded (…${key.slice(-4)}, len=${key.length})`);
}

function llmLogTag(): string {
  return `[${getLlmProvider()}]`;
}

function shouldProxy(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as any).__PRERENDER_INJECTED) return false;
  return !!getEnvCacheUrl();
}

async function callAiProxy(endpoint: string, body: any) {
  const baseUrl = getEnvCacheUrl();
  const url = new URL(endpoint, baseUrl || (typeof window !== "undefined" ? window.location.origin : "")).toString();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, llmProvider: getLlmProvider(), llmModel: getBrowserLlmModel() ?? undefined }),
  });
  if (!resp.ok) throw new Error(`AI Proxy Error (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

async function callAltLlm(system: string, user: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const provider = getLlmProvider();

  if (provider === "anthropic") {
    const key = getAnthropicApiKey();
    if (!key) throw new Error("No VITE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY set");
    logProviderKeyOnce("anthropic", key);
    const model = resolveAnthropicModel();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        ...(system.trim() ? { system: system.trim() } : {}),
        messages: [{ role: "user", content: `${user}\n\nReply with a single valid JSON object only. No markdown, no commentary.` }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${err}`);
    }
    const data = await res.json();
    const block = data?.content?.[0];
    return block?.type === "text" ? block.text : "";
  }

  // OpenAI-compatible: openai or deepseek
  const isOpenAI = provider === "openai";
  const openAi = isOpenAI ? getOpenAiCompatConfig() : null;
  const baseUrl = isOpenAI
    ? openAi!.baseUrl
    : (typeof window === "undefined"
        ? readServerEnv("VITE_DEEPSEEK_BASE_URL", "DEEPSEEK_BASE_URL")
        : readBundledEnv("VITE_DEEPSEEK_BASE_URL")) || "https://api.deepseek.com/v1";
  const model = getServerLlmModelOverride() || (isOpenAI
    ? (typeof window === "undefined"
        ? readServerEnv("VITE_OPENAI_MODEL", "OPENAI_MODEL")
        : readBundledEnv("VITE_OPENAI_MODEL")) || "gpt-4o-mini"
    : (typeof window === "undefined"
        ? readServerEnv("VITE_DEEPSEEK_MODEL", "DEEPSEEK_MODEL")
        : readBundledEnv("VITE_DEEPSEEK_MODEL")) || "deepseek-v4-flash");
  const key = isOpenAI ? openAi!.apiKey : getDeepSeekApiKey();
  if (!key) throw new Error(`No API key set for ${provider}`);
  logProviderKeyOnce(provider, key);

  const headers: Record<string, string> = isOpenAI
    ? { ...openAi!.headers }
    : { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401 && isOpenAI) {
      console.error("[openai] 401 — check key is active, billing, and base URL", {
        baseUrl,
        model,
        keyLen: key.length,
        keySuffix: key.slice(-4),
        hasOpenAIOrganization: !!headers["OpenAI-Organization"],
        hasOpenAIProject: !!headers["OpenAI-Project"],
      });
    }
    throw new Error(`${provider} API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export const defaultStartPairResult = (reason: string, term?: string) => {
  const isPerson = term ? looksLikePersonName(term) : false;
  return {
    type: isPerson ? "Person" : "Event",
    description: "",
    isAtomic: isPerson,
    atomicType: "Person",
    compositeType: "Event",
    reasoning: reason,
  };
};

const SYSTEM_INSTRUCTION = `
You are a Bipartite Graph Generator.
Your goal is to build a graph that alternates between an "Atomic" type and a "Composite" type.

BIPARTITE STRUCTURE:
A bipartite graph alternates between an "Atomic" entity type and a "Composite" entity type.
- Atomic: Fundamental building blocks (e.g., individual people, ingredients, symptoms, authors, actors, components)
- Composite: Collections or works (e.g., events, recipes, diseases, papers, movies, products, organizations)

Common bipartite pairs include:
- Person ↔ Event (works, historical events, organizations, movements)
- Ingredient ↔ Recipe
- Symptom ↔ Disease
- Author ↔ Paper
- Actor ↔ Movie
- Component ↔ Product
- Character ↔ Novel

CRITICAL EXAMPLES TO PREVENT MISCLASSIFICATION:
- "The Godfather" → COMPOSITE (type: Movie, isAtomic: false), pair: Actor ↔ Movie
- "Marlon Brando" → ATOMIC (type: Actor, isAtomic: true), pair: Actor ↔ Movie
- Movies/books/albums are ALWAYS composite (created BY actors/authors/musicians)

Core Rules:
1. If the Source is a Composite, return 8-10 distinct Atomics that are meaningfully connected to it.
2. If the Source is an Atomic, return 8-10 distinct Composites that it is meaningfully connected to.
3. Use Title Case for all names.
4. Return only factually correct information. Do not hallucinate.
5. Return strict JSON only — no prose, no markdown fences.

Output Format Rules:
- wikipediaTitle: Always provide the canonical English Wikipedia article title.
- evidenceSnippet: Provide a 1-sentence evidence snippet explaining the connection.
- evidencePageTitle: Set to the Wikipedia article title the snippet is from.

Entity Classification:
- isAtomic: true for INDIVIDUAL PEOPLE/CHARACTERS, false for WORKS/GROUPS/ORGANIZATIONS.

CRITICAL — DO NOT return:
- YouTube channel names, usernames, or video titles (e.g. "pianetapapalla62", "MyChannel! Video Title")
- Strings that are a username concatenated with a video title
- Any entity whose name looks like an online username (all-lowercase + digits, no spaces)
- Raw video metadata from any platform
Only return canonical real-world named entities: people, musical works, books, films, organizations, historical events.
`;

// Rejects nodes that look like YouTube usernames or video titles rather than real entities.
function isValidEntityName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  // Reject if it contains "! " — YouTube video title separator pattern
  if (trimmed.includes("! ")) return false;
  // Reject if it looks like a username: no spaces, mixes lowercase letters and digits
  if (!/\s/.test(trimmed) && /[a-z]/.test(trimmed) && /\d/.test(trimmed) && trimmed.length > 4) return false;
  // Reject very long single-word strings (likely concatenated junk)
  if (!/\s/.test(trimmed) && trimmed.length > 20) return false;
  return true;
}

export const classifyStartPair = async (
  term: string,
  wikiContext?: string
): Promise<{
  type: string;
  description: string;
  isAtomic: boolean;
  atomicType: string;
  compositeType: string;
  reasoning: string;
}> => {
  const fallback = defaultStartPairResult("Default fallback.", term);

  if (shouldProxy()) {
    const proxyResult = await callAiProxy("/api/ai/classify-start", { term, wikiContext });
    if (!proxyResult.isAtomic && looksLikePersonName(term)) {
      console.warn("[classifyStartPair] proxy returned isAtomic=false for apparent person name; overriding", term);
      return { ...proxyResult, isAtomic: true, type: "Person" };
    }
    return proxyResult;
  }

  const prompt = `Choose the most appropriate bipartite pair for: "${term}".

Rules:
- If "${term}" is an individual human, it is ATOMIC.
- If "${term}" is a WORK (movie, album, book, film, TV show), it is ALWAYS COMPOSITE.
- If "${term}" is an organization/institution/band, it is ALWAYS COMPOSITE.

Return JSON with exactly these fields:
{
  "type": "string",
  "description": "string",
  "isAtomic": boolean,
  "atomicType": "string",
  "compositeType": "string",
  "reasoning": "string"
}`;

  try {
    const raw = await withTimeout(
      withRetry(() => callAltLlm(SYSTEM_INSTRUCTION, prompt), 3, 1000),
      CLASSIFY_TIMEOUT_MS,
      "classifyStartPair timed out"
    );
    const json = parseJsonFromModelText(raw) as Record<string, unknown> | null;
    if (!json) return fallback;
    const s = (v: unknown, fb: string) => (typeof v === "string" && v ? v : fb);
    return {
      type: s(json.type, "Event"),
      description: s(json.description, ""),
      isAtomic: !!json.isAtomic,
      atomicType: s(json.atomicType, "Person"),
      compositeType: s(json.compositeType, "Event"),
      reasoning: s(json.reasoning, ""),
    };
  } catch (e) {
    console.warn(`${llmLogTag()} classifyStartPair failed:`, String(e).slice(0, 200));
    return fallback;
  }
};

export const classifyEntity = async (
  term: string,
  wikiContext?: string
): Promise<{
  type: string;
  description: string;
  isAtomic: boolean;
  atomicType?: string;
  compositeType?: string;
  reasoning?: string;
}> => {
  const fallback = { type: "Event", description: "", isAtomic: false };

  if (shouldProxy()) return callAiProxy("/api/ai/classify", { term, wikiContext });

  const wikiPrompt = wikiContext ? `\n\nUSE THIS VERIFIED INFORMATION:\n${wikiContext}\n` : "";

  const prompt = `Classify "${term}".${wikiPrompt}

Determine if it is Atomic (individual human, ingredient, symptom) or Composite (movie, recipe, disease, organization, historical event).

Return JSON:
{
  "type": "string",
  "description": "string",
  "isAtomic": boolean,
  "atomicType": "string",
  "compositeType": "string",
  "reasoning": "string"
}`;

  try {
    const raw = await withRetry(
      () => withTimeout(callAltLlm(SYSTEM_INSTRUCTION, prompt), CLASSIFY_TIMEOUT_MS, "classifyEntity timed out"),
      3,
      1000
    );
    const json = parseJsonFromModelText(raw) as Record<string, unknown> | null;
    if (!json) return fallback;
    return {
      type: (json.type as string) || "Event",
      description: (json.description as string) || "",
      isAtomic: !!json.isAtomic,
      atomicType: json.atomicType as string | undefined,
      compositeType: json.compositeType as string | undefined,
      reasoning: json.reasoning as string | undefined,
    };
  } catch (e) {
    console.warn(`${llmLogTag()} classifyEntity failed:`, String(e).slice(0, 200));
    return fallback;
  }
};

export const fetchConnections = async (
  nodeName: string,
  context?: string,
  excludeNodes: string[] = [],
  wikiContext?: string,
  wikipediaId?: string,
  atomicType?: string,
  compositeType?: string,
  mentioningPageTitles?: string[]
): Promise<GeminiResponse> => {
  if (shouldProxy()) {
    return callAiProxy("/api/ai/connections", { nodeName, context, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles });
  }

  const atomicLabel = atomicType || "ATOMIC entity";
  const compositeLabel = compositeType || "COMPOSITE entity";
  const wikiIdStr = wikipediaId ? ` (Wikipedia ID: ${wikipediaId})` : "";
  const contextualPrompt = context
    ? `Analyze: "${nodeName}"${wikiIdStr} specifically in the context of "${context}".`
    : `Analyze: "${nodeName}"${wikiIdStr}.`;
  const wikiPrompt = wikiContext ? `\n\nUSE THIS VERIFIED INFORMATION:\n${wikiContext}\n` : "";
  const excludePrompt = excludeNodes.length > 0
    ? `\nDO NOT include these already known connections: ${JSON.stringify(excludeNodes)}. Find NEW connections.`
    : "";
  const mentionPrompt = mentioningPageTitles?.length
    ? `\nThis entity is mentioned in: ${mentioningPageTitles.join(", ")}. Investigate these contexts.`
    : "";

  const prompt = `${contextualPrompt}${wikiPrompt}${mentionPrompt}${excludePrompt}

Return ${excludeNodes.length > 0 ? "6-8 NEW" : "5-6 key"} ${atomicLabel} entities that are fundamental components of this ${compositeLabel}.

Source Node: ${nodeName} (Type: ${compositeLabel})

CRITICAL BIPARTITE RULE: The Source is COMPOSITE, so ALL returned entities MUST be ATOMIC (${atomicLabel}).
${atomicType?.toLowerCase() === "person" ? "CRITICAL: Return ONLY specific individual people with proper names. NO organizations, groups, or locations." : ""}

Return JSON:
{
  "people": [
    {
      "name": "string",
      "isAtomic": true,
      "wikipediaTitle": "string",
      "role": "string",
      "description": "string",
      "evidenceSnippet": "string",
      "evidencePageTitle": "string"
    }
  ]
}`;

  try {
    const raw = await withRetry(
      () => withTimeout(callAltLlm(SYSTEM_INSTRUCTION, prompt), TIMEOUT_MS, "fetchConnections timed out"),
      4,
      1000
    );
    const parsed = parseJsonFromModelText(raw) as GeminiResponse | null;
    if (!parsed || !Array.isArray(parsed.people)) return { people: [] };
    parsed.people = parsed.people
      .filter(p => isValidEntityName(p.name))
      .map(p => ({ ...p, isAtomic: true }));
    return parsed;
  } catch (e) {
    console.error(`${llmLogTag()} fetchConnections error:`, e);
    return { people: [] };
  }
};

export const fetchPersonWorks = async (
  nodeName: string,
  excludeNodes: string[] = [],
  wikiContext?: string,
  wikipediaId?: string,
  atomicType?: string,
  compositeType?: string,
  mentioningPageTitles?: string[]
): Promise<PersonWorksResponse> => {
  if (shouldProxy()) {
    return callAiProxy("/api/ai/works", { nodeName, excludeNodes, wikiContext, wikipediaId, atomicType, compositeType, mentioningPageTitles });
  }

  const atomicLabel = atomicType || "ATOMIC entity";
  const compositeLabel = compositeType || "COMPOSITE entity";
  const wikiIdStr = wikipediaId ? ` (Wikipedia ID: ${wikipediaId})` : "";
  const wikiPrompt = wikiContext ? `\n\nUSE THIS VERIFIED INFORMATION:\n${wikiContext}\n` : "";
  const mentionPrompt = mentioningPageTitles?.length
    ? `\nThis person is mentioned in: ${mentioningPageTitles.join(", ")}. Prioritize these as primary ${compositeLabel} connections.`
    : "";
  const contextPrompt = excludeNodes.length > 0
    ? `Already in graph: ${JSON.stringify(excludeNodes)}. Return 6-8 NEW significant ${compositeLabel} entities for "${nodeName}"${wikiIdStr}.`
    : `List 5-6 distinct, significant ${compositeLabel} entities that "${nodeName}"${wikiIdStr} belongs to or created.`;

  const prompt = `${wikiPrompt}${mentionPrompt}${contextPrompt}

CRITICAL BIPARTITE RULE: "${nodeName}" is ATOMIC, so ALL returned entities MUST be COMPOSITE (${compositeLabel}).

Return JSON:
{
  "works": [
    {
      "entity": "string",
      "isAtomic": false,
      "wikipediaTitle": "string",
      "type": "string",
      "description": "string",
      "role": "string",
      "year": 1990,
      "evidenceSnippet": "string",
      "evidencePageTitle": "string"
    }
  ]
}`;

  try {
    const raw = await withRetry(
      () => withTimeout(callAltLlm(SYSTEM_INSTRUCTION, prompt), TIMEOUT_MS, "fetchPersonWorks timed out"),
      4,
      1000
    );
    const parsed = parseJsonFromModelText(raw) as PersonWorksResponse | null;
    if (!parsed || !Array.isArray(parsed.works)) return { works: [] };
    parsed.works = parsed.works
      .filter(w => isValidEntityName(w.entity))
      .map(w => ({ ...w, isAtomic: false }));
    return parsed;
  } catch (e) {
    console.error(`${llmLogTag()} fetchPersonWorks error:`, e);
    return { works: [] };
  }
};

export const fetchConnectionPath = async (
  start: string,
  end: string,
  context?: { startWiki?: string; endWiki?: string }
): Promise<PathResponse> => {
  if (shouldProxy()) return callAiProxy("/api/ai/path", { start, end, context });

  const wikiPrompt = (context?.startWiki || context?.endWiki)
    ? `\n\nVERIFIED INFO:\n${context?.startWiki ? `[${start}]: ${context.startWiki}\n` : ""}${context?.endWiki ? `[${end}]: ${context.endWiki}\n` : ""}`
    : "";

  const prompt = `Find a connection path between "${start}" and "${end}".${wikiPrompt}

Rules:
1. The path MUST ALTERNATE between Person and Event (organizations, works, projects, places count as Event).
2. A Person MUST NOT connect directly to another Person.
3. Each step must be a direct, verifiable collaboration or relationship.
4. Use 1-4 intermediary entities.

Return JSON:
{
  "path": [
    { "id": "string", "type": "string", "description": "string", "justification": "string", "year": 1950 }
  ]
}`;

  try {
    const raw = await withTimeout(
      callAltLlm(SYSTEM_INSTRUCTION, prompt),
      45000,
      "fetchConnectionPath timed out"
    );
    const json = parseJsonFromModelText(raw) as { path?: PathResponse["path"] } | null;
    if (!json || !Array.isArray(json.path)) return { path: [], found: false };
    return { path: json.path, found: json.path.length > 0 };
  } catch (e) {
    console.error(`${llmLogTag()} fetchConnectionPath error:`, e);
    return { path: [], found: false };
  }
};

export const findWikipediaTitle = async (
  name: string,
  description?: string
): Promise<{ title: string; imageHint?: string } | null> => {
  if (shouldProxy()) return callAiProxy("/api/ai/title", { name, description });

  const prompt = `Find the exact English Wikipedia article title for "${name}"${description ? ` described as "${description}"` : ""}.

Return JSON:
{
  "title": "Exact Wikipedia Title",
  "imageHint": "Optional Wikimedia Commons filename like 'File:Name.jpg' or null"
}`;

  try {
    const raw = await withTimeout(
      callAltLlm("You are a Wikipedia lookup assistant. Return strict JSON only.", prompt),
      10000,
      "findWikipediaTitle timed out"
    );
    const json = parseJsonFromModelText(raw) as { title?: string; imageHint?: string } | null;
    if (!json || typeof json.title !== "string" || !json.title.trim()) return null;
    return { title: json.title, imageHint: json.imageHint };
  } catch {
    return null;
  }
};

