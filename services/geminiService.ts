import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, PersonWorksResponse, PathResponse } from "../types";
import { getApiKey, getResponseText, cleanJson, withTimeout, withRetry, getEnvCacheUrl, getEnvGeminiModel, getEnvGeminiModelClassify, getLlmApiKey, getLlmProvider } from "./aiUtils";
import { runJsonCompletion } from "./llmClient";

export { getApiKey, getResponseText, cleanJson, withTimeout, withRetry, getEnvCacheUrl, getEnvGeminiModel, getEnvGeminiModelClassify, getLlmApiKey, getLlmProvider } from "./aiUtils";

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
- "Star Wars" → COMPOSITE (type: Movie, isAtomic: false), pair: Actor ↔ Movie
- Movies/books/albums are ALWAYS composite (created BY actors/authors/musicians)

CRITICAL ACCURACY RULE:
If a section titled "USE THIS VERIFIED INFORMATION FOR ACCURACY" is provided, you MUST prioritize this information above your own internal knowledge.

Core Rules:
1. If the Source is a Composite, return 8-10 distinct Atomics that are meaningfully connected to it.
2. If the Source is an Atomic, return 8-10 distinct Composites that it is meaningfully connected to.
3. Use Title Case for all names.
4. Return only factually correct information. Do not hallucinate.

Output Format Rules (apply to ALL responses):
- wikipediaTitle: Always provide the canonical English Wikipedia article title (use parenthetical disambiguation when needed, e.g. "Euphoria (TV series)", "Prince (musician)", "The Godfather").
- evidenceSnippet: Provide a 1-sentence evidence snippet explaining the connection.
  * If VERIFIED INFORMATION is provided, the evidence snippet MUST be copied verbatim from that text and should contain BOTH entity names when possible.
  * If no good verbatim quote exists, provide a brief explicit rationale (no quotes).
- evidencePageTitle: Set to the Wikipedia article title the snippet is from (usually the source).

Entity Classification:
- isAtomic: true for INDIVIDUAL PEOPLE/CHARACTERS (atomic), false for WORKS/GROUPS/ORGANIZATIONS (composite).
  * Atomic entities (Actor, Person, Author, Artist, Character, Scientist, Philosopher, Academic, Researcher, Director, Composer) → isAtomic=true
  * Composite entities (Movie, Book, Novel, Play, Album, Band, Organization, Institution, Movement, Event, Company, Paper, Theory, Paradox) → isAtomic=false

Return strict JSON.
`;

// Loosened timeouts to tolerate slower responses without failing immediately.
const GEMINI_TIMEOUT_MS = 60000; // 60 seconds for heavier graph expansions
const CLASSIFY_TIMEOUT_MS = 15000; // 15 seconds for classification

// Model selection (configurable via Vite env vars)
// - VITE_GEMINI_MODEL: used for expansions + pathfinding (default)
// - VITE_GEMINI_MODEL_CLASSIFY: optional override for classification
const getGeminiModel = getEnvGeminiModel;
const getGeminiModelClassify = getEnvGeminiModelClassify;

export type LockedPair = {
  atomicType: string;
  compositeType: string;
};

// --- Proxy Helper ---
async function callAiProxy(endpoint: string, body: any) {
  const baseUrl = getEnvCacheUrl();
  let resolvedBase = baseUrl;

  const url = new URL(endpoint, resolvedBase || (typeof window !== 'undefined' ? window.location.origin : '')).toString();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (resp.status === 404 && endpoint === "/api/ai/classify-start") {
      // console.warn(`⚠️ [Proxy] ${endpoint} not found, falling back to /api/ai/classify`);
      return callAiProxy("/api/ai/classify", body);
    }

    if (!resp.ok) {
      const err = await resp.text();
      const degraded =
        resp.status === 500 ||
        resp.status === 502 ||
        resp.status === 503 ||
        resp.status === 429;
      // Degrade gracefully when the cache server errors (quota, old deploy, etc.) so the UI keeps working.
      if (degraded && endpoint === "/api/ai/connections") {
        console.warn(`[Proxy] ${endpoint} ${resp.status}; returning empty people.`, err.slice(0, 300));
        return { people: [] };
      }
      if (degraded && endpoint === "/api/ai/works") {
        console.warn(`[Proxy] ${endpoint} ${resp.status}; returning empty works.`, err.slice(0, 300));
        return { works: [] };
      }
      if (degraded && endpoint === "/api/ai/path") {
        console.warn(`[Proxy] ${endpoint} ${resp.status}; returning empty path.`, err.slice(0, 300));
        return { path: [], found: false };
      }
      if (degraded && endpoint === "/api/ai/classify-start") {
        console.warn(`[Proxy] ${endpoint} ${resp.status}; defaulting start pair.`, err.slice(0, 300));
        return defaultStartPairResult(
          "Classification proxy error (quota or server); defaulting to Person↔Event."
        );
      }
      if (degraded && endpoint === "/api/ai/classify") {
        console.warn(`[Proxy] ${endpoint} ${resp.status}; defaulting classify.`, err.slice(0, 300));
        return { type: "Event", description: "", isAtomic: false };
      }
      throw new Error(`AI Proxy Error (${resp.status}): ${err}`);
    }
    return resp.json();
  } catch (e: any) {
    if (endpoint === "/api/ai/classify-start" && !e.message?.includes("AI Proxy Error")) {
      // Network error or fetch failure, try fallback anyway if it's the start pair
      // console.warn(`⚠️ [Proxy] ${endpoint} failed, trying fallback /api/ai/classify`, e);
      return callAiProxy("/api/ai/classify", body);
    }
    throw e;
  }
}

/**
 * Helper to determine if we should use the proxy (browser + proxy URL available).
 */
function shouldProxy(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__PRERENDER_INJECTED) return false;

  const baseUrl = getEnvCacheUrl();
  return !!baseUrl;
}

export function defaultStartPairResult(reason: string): {
  type: string;
  description: string;
  isAtomic: boolean;
  atomicType: string;
  compositeType: string;
  reasoning: string;
} {
  return {
    type: "Event",
    description: "",
    isAtomic: false,
    atomicType: "Person",
    compositeType: "Event",
    reasoning: reason,
  };
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
  if (shouldProxy()) {
    return callAiProxy("/api/ai/classify-start", { term, wikiContext });
  }

  const apiKey = await getLlmApiKey();
  // String-level safety heuristic (no Wikipedia required):
  // Disambiguated titles like "Discover (Daft Punk album)" must never be treated as Person.
  // Treat common work/media parentheticals as Composite/Event in the temporary Person↔Event model.
  const t = term.trim();
  // Academic heuristics (no model required):
  // If the seed looks like a paper/DOI/arXiv query, default to Author↔Paper so the system can use an academic corpus.
  if (/\b10\.\d{4,9}\/\S+\b/i.test(t) || /\barxiv\b|arxiv:\s*\d{4}\.\d{4,5}/i.test(t)) {
    return {
      type: "Paper",
      description: "",
      isAtomic: false,
      atomicType: "Author",
      compositeType: "Paper",
      reasoning: "Seed looks like an academic paper identifier (DOI/arXiv); selecting Author↔Paper."
    };
  }
  if (/\((album|song|single|film|movie|tv series|television series|book|novel|painting|sculpture|artwork|opera|symphony)\)/i.test(t)) {
    return {
      type: "Event",
      description: "",
      isAtomic: false,
      atomicType: "Person",
      compositeType: "Event",
      reasoning: "Title contains an explicit work/media disambiguator (e.g., '(album)'); treating it as Composite in Person↔Event."
    };
  }


  if (!apiKey) {
    return defaultStartPairResult("No API key available; defaulting to Person↔Event.");
  }

  const useGemini = getLlmProvider() === "gemini";
  const gemini = useGemini ? new GoogleGenAI({ apiKey }) : null;

  const prompt = `Choose the most appropriate bipartite pair for this session based on the input: "${term}".

You may identify other valid bipartite structures if appropriate for "${term}".

Rules:
- If "${term}" is an individual human (one person, one actor), it is ATOMIC (type: Person or Actor).
- If "${term}" is a WORK (movie, album, book, film, TV show, painting, song), it is ALWAYS COMPOSITE (type: Movie, Book, Album, etc.).
- If "${term}" is an organization/institution/band, it is ALWAYS COMPOSITE.
- If "${term}" looks like an academic paper or DOI/arXiv, it is COMPOSITE (use Author ↔ Paper).
- If "${term}" is a very famous person, it is ATOMIC even if they have works.
`;

  try {
    const rawText = await runJsonCompletion({
      user: prompt,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      attempts: 3,
      gemini: gemini
        ? () =>
            gemini.models.generateContent({
              model: getGeminiModelClassify(),
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    description: { type: Type.STRING },
                    isAtomic: { type: Type.BOOLEAN },
                    atomicType: { type: Type.STRING },
                    compositeType: { type: Type.STRING },
                    reasoning: { type: Type.STRING }
                  },
                  required: ["type", "isAtomic", "atomicType", "compositeType"]
                }
              }
            })
        : undefined,
    });
    // console.log(`🤖 [Gemini] Raw Classify-Start response for "${term}":`, rawText);
    const text = cleanJson(rawText);
    const json = text ? JSON.parse(text) : {};

    return {
      type: json.type || "Event",
      description: json.description || "",
      isAtomic: !!json.isAtomic,
      atomicType: json.atomicType || "Person",
      compositeType: json.compositeType || "Event",
      reasoning: json.reasoning || ""
    };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    console.warn(`[classifyStartPair] failed for "${term}":`, msg.slice(0, 200));
    return defaultStartPairResult(
      "Classification API unavailable (quota, rate limit, or error); defaulting to Person↔Event."
    );
  }
};

export const classifyEntity = async (term: string, wikiContext?: string): Promise<{
  type: string;
  description: string;
  isAtomic: boolean;
  atomicType?: string;
  compositeType?: string;
  reasoning?: string;
}> => {
  if (shouldProxy()) {
    return callAiProxy("/api/ai/classify", { term, wikiContext });
  }

  const apiKey = await getLlmApiKey();
  const normalized = term.trim().toLowerCase();

  // String-level safety heuristic (no Wikipedia required):
  // Disambiguated titles like "... (album)" must never be treated as Person.
  if (/\((album|song|single|film|movie|tv series|television series|book|novel|painting|sculpture|artwork|opera|symphony)\)/i.test(term.trim())) {
    return {
      type: "Event",
      description: "",
      isAtomic: false,
      atomicType: "Person",
      compositeType: "Event",
      reasoning: "Title contains an explicit work/media disambiguator (e.g., '(album)'); treating it as Composite in Person↔Event."
    };
  }


  if (!apiKey) {
    console.error("❌ [Gemini] classifyEntity: No API key found");
    return { type: 'Event', description: '', isAtomic: false };
  }
  const useGemini = getLlmProvider() === "gemini";
  const gemini = useGemini ? new GoogleGenAI({ apiKey }) : null;

  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  try {
    const prompt = `Classify "${term}". ${wikiPrompt}
      Determine if it is "Atomic" (a fundamental building block like an individual human person, ingredient, or symptom)
      or "Composite" (a collection/group/institution/work/event like a movie, recipe, disease, organization, or historical incident).

      IMPORTANT:
      - "Person" means an individual human only.
      - Organizations, institutions, committees, societies, companies, and museums are NOT persons.
      - Philosophers, Scientists, and Academics are INDIVIDUAL PEOPLE and should be ATOMIC (isAtomic: true).
      - In the Person↔Event pairing, treat organizations as "Event" (Composite), NOT "Person".
      - In the Person↔Event pairing, treat named works (albums, songs, books, novels, films, paintings, artworks) as "Event" (Composite), NOT "Person".
      - In the Person↔Event pairing, treat major scientific theories, concepts, discoveries, paradoxes, or areas of study (e.g., "General Relativity", "Evolution", "Quantum Mechanics", "Russell's Paradox") as "Event" (Composite), NOT "Person".
      - If the title explicitly contains a disambiguator like "(album)" / "(film)" / "(book)", it is a work: treat it as "Event" (Composite).
      
      Identify the relevant Bipartite Pair this belongs to (e.g. Actor/Movie, Ingredient/Recipe, Symptom/Disease, Person/Event).
      
      Return JSON:
      {
        "type": "Specific Type (one of: Person, Event, Ingredient, Recipe, Symptom, Disease, Author, Paper)",
        "description": "Short 1-sentence description",
        "isAtomic": true/false,
        "atomicType": "The atomic labels (Person, Ingredient, Symptom, or Author)",
        "compositeType": "The composite labels (Event, Recipe, Disease, or Paper)",
        "reasoning": "Brief explanation"
      }`;

    // console.log("🤖 [Gemini] Classify Prompt:", prompt);

    const rawText = await runJsonCompletion({
      user: prompt,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      attempts: 3,
      gemini: gemini
        ? () =>
            gemini.models.generateContent({
              model: getGeminiModelClassify(),
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    description: { type: Type.STRING, description: "Short 1-sentence description" },
                    isAtomic: { type: Type.BOOLEAN },
                    atomicType: { type: Type.STRING },
                    compositeType: { type: Type.STRING },
                    reasoning: { type: Type.STRING }
                  },
                  required: ["type", "isAtomic", "atomicType", "compositeType"]
                }
              }
            })
        : undefined,
    });
    // console.log(`🤖 [Gemini] Raw Classify response for "${term}":`, rawText);
    const text = cleanJson(rawText);
    // console.log("Classify response text:", text);
    if (!text) return { type: 'Event', description: '', isAtomic: false };
    const json = JSON.parse(text);
    return {
      type: json.type || 'Event',
      description: json.description || '',
      isAtomic: !!json.isAtomic,
      atomicType: json.atomicType,
      compositeType: json.compositeType,
      reasoning: json.reasoning
    };
  } catch (error) {
    // console.warn("Classification failed, defaulting to Event:", error);
    return { type: 'Event', description: '', isAtomic: false };
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

  try {
  const apiKey = await getLlmApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] fetchConnections: No API key found");
    return { people: [] };
  }

  const useGemini = getLlmProvider() === "gemini";
  const gemini = useGemini ? new GoogleGenAI({ apiKey }) : null;

  const wikiIdStr = wikipediaId ? ` (Wikipedia ID: ${wikipediaId})` : "";
  const contextualPrompt = context
    ? `Analyze: "${nodeName}"${wikiIdStr} specifically in the context of "${context}".`
    : `Analyze: "${nodeName}"${wikiIdStr}.`;

  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  const excludePrompt = excludeNodes.length > 0
    ? `\nDO NOT include the following already known connections: ${JSON.stringify(excludeNodes)}. Find NEW high-impact connections.`
    : "";

  const mentionPrompt = mentioningPageTitles && mentioningPageTitles.length > 0
    ? `\nIMPORTANT: This entity does not have a dedicated Wikipedia article, but it is explicitly mentioned in the following Wikipedia articles: ${mentioningPageTitles.join(', ')}. You MUST investigate these contexts and include relevant connections found there.`
    : "";

  const atomicLabel = atomicType || "ATOMIC entity";
  const compositeLabel = compositeType || "COMPOSITE entity";
  const personOnlyRule =
    (atomicType || "").trim().toLowerCase() === "person"
      ? `\nCRITICAL: The atomic side is "Person" meaning INDIVIDUAL HUMAN BEINGS ONLY.
- Return ONLY specific individual people with proper names (e.g., "Leonardo da Vinci"), not categories, groups, or locations.
- DO NOT return organizations, institutions, committees, councils, companies, museums, foundations, agencies, or any group entities (e.g., do NOT return "Republic of Florence" as a person).
- DO NOT return locations, places, buildings, or geographical entities (e.g., do NOT return "Florence" or "Italy").
- DO NOT return generic or collective phrases like "Various Local Artists", "Local Artists", "Staff", "Visitors", "Students", "Members", "Volunteers", "Team", "The Public", "Curators".
- If you cannot find enough specific individual humans, return fewer.`
      : "";
  const workSourceHint =
    (compositeType || "").trim().toLowerCase() === "event"
      ? `\nIf the Source is a named work (e.g., artwork/painting/sculpture/album/book/novel/film), you MUST return the primary creator(s) (author, artist, director, etc.) as the first few results. DO NOT omit the creator even if they are already widely known. Return people directly connected to the work (creator, depicted subject/model if distinct, commissioners/patrons, notable collectors/owners, curators/restorers/biographers explicitly associated). 
- Do NOT invent names; if only the creator is reliably connected, return only that person.`
      : "";
  const theorySourceHint =
    /\b(theory|concept|discovery|law|principle|formula|field|science|physics|mathematics|biology|chemistry|mechanics|evolution|relativity)\b/i.test(compositeType || "") ||
      /\b(theory|physics|mathematics|discovery|principle|mechanics|evolution|relativity)\b/i.test(nodeName)
      ? `\nSPECIAL CASE (theory/concept/discovery): If the Source is a scientific theory, concept, or discovery, return the primary scientists, authors, or discoverers who established or significantly developed it.`
      : "";

    const prompt = `${contextualPrompt}${wikiPrompt}${mentionPrompt}${excludePrompt}
      Source Node: ${nodeName} (Type: ${compositeLabel})
      
      Return ${excludeNodes.length > 0 ? '12-15 NEW' : '10-12 key'} ${atomicLabel} entities (participants, creators, major figures, stars, ingredients, its most famous writers/editors for magazines, etc.) that are fundamental components of this ${compositeLabel}.
      
      Straying Guardrails:
      ${personOnlyRule}
      ${workSourceHint}
      ${theorySourceHint}
      ${(compositeType || "").match(/^(Movie|Film|Book|Novel|Play|Opera)$/i) ? '\nSPECIAL CASE (Fiction): For works of fiction, prioritize returning CHARACTERS as the atomic entities.' : ''}
      ${(compositeType || "").match(/^(Magazine|Newspaper|Journal|Periodical|Publication)$/i) ? '\nSPECIAL CASE (Magazine): For periodicals/magazines, prioritize returning its most FAMOUS AND LONG-TIME WRITERS, columnists, and editors-in-chief. If some of these are already in the graph, find other significant figures.' : ''}
      
      CRITICAL BIPARTITE RULE:
      - The Source Node is a COMPOSITE entity.
      - Therefore, ALL returned entities MUST be ATOMIC entities (${atomicLabel}).
      - DO NOT return other ${compositeLabel} entities.
      - If you find connections to other ${compositeLabel} entities, you MUST find the ${atomicLabel} entities (people, characters, etc.) that link them.

      ${excludeNodes.length > 0 ? `\nEXPAND MORE: Since you have already provided some connections, please dig deeper into the "next tier" of significant entities. Avoid the obvious names already in the graph: ${JSON.stringify(excludeNodes)}.` : ''}

      IMPORTANT: For each entity specify its type (${atomicLabel}) and whether it follows the classification rules defined in the system instruction.
      
      Examples:
      - If Fiction (Book, Novel, Movie, Play): Return its most famous CHARACTERS.
      - If Magazine/Newspaper: Return its most legendary WRITERS and EDITORS.
      - If Theory/Discovery: Return the primary scientists or researchers involved.
      - If Event/Incident: Return key people involved.
      - If Team: Return key players.
      - If Recipe: Return ingredients.
      - If Disease: Return symptoms.`;

    // console.log(`🤖 [Gemini] fetchConnections Prompt for "${nodeName}":`, prompt);

    const rawText = await runJsonCompletion({
      system: SYSTEM_INSTRUCTION,
      user: prompt,
      timeoutMs: GEMINI_TIMEOUT_MS,
      attempts: 4,
      gemini: gemini
        ? () =>
            gemini.models.generateContent({
              model: getGeminiModel(),
              contents: prompt,
              config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    sourceYear: { type: Type.INTEGER, description: "Year of the source node" },
                    people: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          isAtomic: { type: Type.BOOLEAN, nullable: true, description: "True if atomic, false if composite" },
                          wikipediaTitle: { type: Type.STRING, nullable: true, description: "Canonical English Wikipedia article title for this entity (use disambiguation parentheses when needed)" },
                          role: { type: Type.STRING, nullable: true, description: "Role in the requested Source Node" },
                          description: { type: Type.STRING, nullable: true, description: "Short 1-sentence bio" },
                          evidenceSnippet: { type: Type.STRING, description: "1 sentence evidence; if VERIFIED INFORMATION is provided, prefer verbatim from it" },
                          evidencePageTitle: { type: Type.STRING, description: "Wikipedia page title where the snippet came from (usually the source)" }
                        },
                        required: ["name", "evidenceSnippet", "evidencePageTitle"]
                      }
                    }
                  },
                  required: ["people"]
                }
              }
            })
        : undefined,
    });
    // console.log(`🤖 [Gemini] Raw response for "${nodeName}":`, rawText);
    const text = cleanJson(rawText);
    if (!text) return { people: [] };

    const parsed = JSON.parse(text) as GeminiResponse;
    const list = Array.isArray(parsed.people) ? parsed.people : [];
    // Force correct bipartite type regardless of LLM slip-ups
    parsed.people = list.map(p => ({
      ...p,
      isAtomic: true // In fetchConnections, the source is COMPOSITE, so all results MUST be ATOMIC (true)
    }));

    return parsed;
  } catch (error) {
    console.error("Gemini API Error (connections):", error);
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

  const apiKey = await getLlmApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] fetchPersonWorks: No API key found");
    throw new Error("No API key found");
  }

  const useGemini = getLlmProvider() === "gemini";
  const gemini = useGemini ? new GoogleGenAI({ apiKey }) : null;

  const wikiIdStr = wikipediaId ? ` (Wikipedia ID: ${wikipediaId})` : "";
  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  const atomicLabel = atomicType || "ATOMIC entity";
  const compositeLabel = compositeType || "COMPOSITE entity";

  const mentionPrompt = mentioningPageTitles && mentioningPageTitles.length > 0
    ? `\nIMPORTANT: This person does not have a dedicated Wikipedia article, but they are explicitly mentioned in these Wikipedia articles: ${mentioningPageTitles.join(', ')}. Prioritize these as the primary ${compositeLabel} connections for this person.`
    : "";

  const dateRequired = (compositeType || "").match(/^(Event|Paper|Work|Movie|Film|Book|Novel|Album|Song|Composition|Artwork|Painting|Sculpture)$/i) ||
    (compositeLabel.toLowerCase().includes('event') || compositeLabel.toLowerCase().includes('work'));

  const dateRequirementPrompt = dateRequired
    ? `\nDATE REQUIREMENT:
       - Every ${compositeLabel} MUST have a valid year (creation, publication, start date, or occurrence).
       - If you do not know the year, DO NOT include the entity.`
    : "";

  const contextPrompt = excludeNodes.length > 0
    ? `The user graph already contains these nodes connected to ${nodeName}${wikiIdStr}: ${JSON.stringify(excludeNodes)}.
       Return 12-15 NEW significant ${compositeLabel} entities.`
    : `List 10-12 DISTINCT, significant ${compositeLabel} entities that this ${atomicLabel} "${nodeName}"${wikiIdStr} belongs to or is part of.
       
       CRITICAL: A ${compositeLabel} must be a named organization, team, project, work, recipe, disease, location, or specific historical event/incident.
       DO NOT return descriptive phrases, facts, or achievements.
       In the Person↔Event pair, treat locations (like "Saint-Paul-de-Mausole") as ${compositeLabel} entities.
       ${dateRequirementPrompt}
       
       BIDIRECTIONAL RULE:
       - If "${nodeName}" is an author, you should prioritize including their most famous books/novels/works (unless already in the excluded list).
       - If "${nodeName}" is a book, novel, movie, or play, you should prioritize including its most famous CHARACTERS (unless already in the excluded list).
       - If "${nodeName}" is an artist, you should prioritize including their most famous paintings/sculptures/artworks (unless already in the excluded list).
       - If "${nodeName}" is a writer famous for writing in a specific MAGAZINE (e.g., The New Yorker), you should prioritize including that Magazine (unless already in the excluded list).
       - Ensure that if a user expands a creator, they find their works, and vice-versa.
       
       BUSINESSPERSON GUARDRAIL:
       - If "${nodeName}" appears to be an entrepreneur/business executive/investor, return ONLY organizations/companies/projects where they had a DIRECT ROLE (founder/co-founder/CEO/executive/chairman/partner/board member).
       - DO NOT return generic "companies acquired by X" lists unless "${nodeName}" personally founded/led the acquired company or was a named executive involved.
       - Prefer fewer, higher-confidence entities over a long list of weakly-related acquisitions.

        FAMOUS MEETING RULE:
        - Prioritize cases where two famous people finally meet each other in person or by some other direct one-on-one connection.
        - PREFER: Specific events (summits, premieres, dinners, lab meetings) over broad eras or movements.
        - AVOID: Broad eras (e.g., "World War II", "Civil Rights Movement") or shared workplaces (e.g., "Bell Labs", "Hollywood") unless no specific meeting or project exists.
        - Illustrative Example: Alan Turing -> Meeting at Bell Labs (1943) -> Claude Shannon (BETTER than Turing -> World War II -> Shannon).
        - Illustrative Example: Goethe -> Meeting at Teplitz -> Beethoven (BETTER than Goethe -> Romanticism -> Beethoven).

       SPECIAL CASE (art): If "${nodeName}" is an artist (painter/sculptor/architect/photographer), include their major named artworks as returned entities.
       - These artworks may be primarily made by a single person; that is OK.
       - Set the returned item's "type" field to "Artwork" (or "Architecture" / "Sculpture" / "Painting" when clearly applicable).
       - ALSO include a few multi-person art-world composites when applicable (e.g., key exhibitions featuring the artist, major movements the artist is associated with, or well-known patronage/collector contexts) to avoid dead-end single-person works.
       - If you include those, set their type to "Event" or "Exhibition" or "Movement" as appropriate.
       - QUOTA: For an artist, return AT LEAST 6 specific named works by the artist (paintings, sculptures, buildings, photo series).
       - Movements/periods/styles (e.g., "Impressionism", "Modernism") must be at most 1 item total, and only if you also returned >=6 works.
       - Do NOT return only movements/periods/styles; the primary goal is to list the artist's works.
       - Prefer the artist's works over generic groupings. For painters, return paintings/series by name (e.g., "Water Lilies", "Impression, Sunrise", "Haystacks", "Rouen Cathedral series").

       SPECIAL CASE (music): If "${nodeName}" is a musician (instrumentalist/composer/songwriter), include major named albums/compositions.
       - Albums and major compositions are valid ${compositeLabel} in this system.
       - Set the returned item's "type" to "Album" (or "Composition" / "Symphony" / "Song" when clearly applicable).
       - QUOTA: For a musician, return AT LEAST 6-8 specific major albums or compositions.

       SPECIAL CASE (ingredient/food): If "${nodeName}" is an ingredient or food item, return 8-10 specific recipes that prominently feature this ingredient.
       - Set the returned item's "type" field to "Recipe".
       - Return well-known, named recipes (e.g., for "Beef": "Beef Wellington", "Beef Bourguignon", "Steak Tartare", "Korean Bulgogi", "Beef Stroganoff", "Pho", "Beef Rendang", "Chili con Carne").
       - Ensure variety in cuisines and preparation styles.
       - Do NOT return generic terms like "beef dishes" - return specific, named recipes.

       SPECIAL CASE (academia/math): If "${nodeName}" is a mathematician/scientist/researcher, include major named papers (often coauthored).
       - Papers are valid ${compositeLabel} in this system.
       - Prefer coauthored papers when possible (they connect to multiple people).
       - Set the returned item's "type" to "Paper" when returning papers.

       DIAMBIGUATION WARNING: Many entities share titles with famous songs, movies, or TV shows. 
       STRICTLY avoid pop-culture hallucinations. 
       Example: If a professional architect is mentioned in a book/interview called "Still Standing", DO NOT return the Elton John song "I'm Still Standing" unless the architect actually wrote/performed it. 
       Only return connections that are professionally or historically relevant to the specific individual described in the VERIFIED INFORMATION.

       IMPORTANT: For each returned entity:
       - Classify per system instruction rules (${atomicLabel} → isAtomic=false for works)
       - year: The 4-digit year of creation, publication, or occurrence. Required if it is an Event/Work.
       
       Examples:
       - For a Person involved in a recent event: Return the named Event or Incident (e.g. "Killing of Renee Good", "2026 Minneapolis Protests").
       - For an Ingredient (e.g. "Chicken"): Return specific Recipes.
       - For an Actor: Return specific Movies.
       - For an Artist: Return specific major Artworks (e.g., "Mona Lisa", "The Last Supper") and optionally a few key Exhibitions/Movements.
       - For a Mathematician: Return specific named Papers (often coauthored).
        
        CRITICAL BIPARTITE RULE:
        - The Source Node "${nodeName}" is an ATOMIC entity.
        - Therefore, ALL returned entities MUST be COMPOSITE entities (${compositeLabel}).
        - DO NOT return other ${atomicLabel} entities (other people, actors, or characters).
        - If "Bugs Bunny" has a rivalry with "Daffy Duck", DO NOT return "Daffy Duck". Instead, return the specific MOVIES or SERIES they appear in together.`;

  try {
    const prompt = `${wikiPrompt}${mentionPrompt}${contextPrompt}
      Ensure each entry is a different entity. ${dateRequired ? 'Sort by year. STRICTLY avoid entities without a known year.' : 'Sort by year if applicable.'}`;

    // console.log(`🤖 [Gemini] fetchPersonWorks Prompt for "${nodeName}":`, prompt);

    const rawText = await runJsonCompletion({
      system: SYSTEM_INSTRUCTION,
      user: prompt,
      timeoutMs: GEMINI_TIMEOUT_MS,
      attempts: 4,
      gemini: gemini
        ? () =>
            gemini.models.generateContent({
              model: getGeminiModel(),
              contents: prompt,
              config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    works: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          entity: { type: Type.STRING },
                          isAtomic: { type: Type.BOOLEAN, nullable: true, description: "True if atomic, false if composite" },
                          wikipediaTitle: { type: Type.STRING, nullable: true, description: "Canonical English Wikipedia article title for this entity (use disambiguation parentheses when needed)" },
                          type: { type: Type.STRING },
                          description: { type: Type.STRING, nullable: true, description: "Short 1-sentence description" },
                          role: { type: Type.STRING, nullable: true },
                          year: { type: Type.INTEGER, nullable: true, description: "4-digit year (YYYY), required for events/works" },
                          evidenceSnippet: { type: Type.STRING, description: "1 sentence evidence; if VERIFIED INFORMATION is provided, prefer verbatim from it" },
                          evidencePageTitle: { type: Type.STRING, description: "Wikipedia page title where the snippet came from (usually the source)" }
                        },
                        required: ["entity", "type", "evidenceSnippet", "evidencePageTitle"]
                      }
                    }
                  },
                  required: ["works"]
                }
              }
            })
        : undefined,
    });
    // console.log(`🤖 [Gemini] Raw response for "${nodeName}" (works):`, rawText);
    const text = cleanJson(rawText);
    if (!text) return { works: [] };
    const parsed = JSON.parse(text) as PersonWorksResponse;
    if (!Array.isArray(parsed.works)) parsed.works = [];
    // Force correct bipartite type regardless of LLM slip-ups
    if (dateRequired) {
      parsed.works = parsed.works.filter(w => w.year !== null && w.year !== undefined && !isNaN(Number(w.year)));
    }
    parsed.works = parsed.works.map(w => ({
      ...w,
      isAtomic: false // In fetchPersonWorks, the source is ATOMIC, so all results MUST be COMPOSITE (false)
    }));
    return parsed;
  } catch (error) {
    console.error("Gemini API Error (Person Works):", error);
    return { works: [] };
  }
};

export const fetchConnectionPath = async (start: string, end: string, context?: { startWiki?: string; endWiki?: string }): Promise<PathResponse> => {
  if (shouldProxy()) {
    return callAiProxy("/api/ai/path", { start, end, context });
  }

  const apiKey = await getLlmApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] fetchConnectionPath: No API key found");
    throw new Error("No API key found");
  }

  const useGemini = getLlmProvider() === "gemini";
  const gemini = useGemini ? new GoogleGenAI({ apiKey }) : null;

  const wikiPrompt = (context?.startWiki || context?.endWiki)
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${context?.startWiki ? `[${start}]: ${context.startWiki}\n` : ''}${context?.endWiki ? `[${end}]: ${context.endWiki}\n` : ''}`
    : "";

  const prompt = `Find a connection path between "${start}" and "${end}".
    ${wikiPrompt}
    
    Your goal is to find the most direct and historically significant connection path.
    
    CRITICAL RULES:
    1. The path must ALTERNATE between "Person" and "Event" (where "Event" includes organizations, programs, shows, works, projects, places, etc.; anything that is not a person).
    2. A "Person" MUST NOT be connected directly to another "Person".
    3. An "Event" MUST NOT be connected directly to another "Event".
    4. Each step must be a direct and verifiable collaboration, affiliation, or relationship.
    5. The path must be a continuous chain where each node is connected to the next.
    6. For every "Event" that is an actual Event, Show, Program, Work, or Historical Occurrence, strictly provide the Year it occurred or was created in the "year" field. If it is a persistent entity without a clear year (like a Location or specialized Concept), year is optional.
    7. MEDIA PERSONALITIES RULE: When connecting media personalities (journalists, hosts, actors, comedians), you MUST use specific TV programs, radio shows, movies, plays, or books they worked on together as the connecting "Event".
        - PREFER: Specific shared credits (e.g., "The Daily Show", "Crossfire", "Saturday Night Live").
        - AVOID: Broad networks or shared employers (e.g., "Fox News", "CNN", "NBC") unless no specific show exists.
        - AVOID: Broad professional categories (e.g., "Journalism", "Comedy").

    8. ACADEMIC & SCIENTIFIC RULE: For philosophers, scientists, and academics, you COMPLETE INTELLECTUAL SPECIFICITY.
        - HIGHEST PRIORITY: "Eponymous Concepts" (Paradoxes, Theorems, Laws, Constants named after them) that connect them (e.g., "Russell's Paradox", "Gödel's Incompleteness Theorems").
        - HIGH PRIORITY: "Direct Correspondence" (e.g., specific letter exchanges) and "Specific Co-authored Works" (books, papers).
        - STRICTLY FORBIDDEN: Do NOT return another Person (Name) as the connecting node. The connection MUST be a composite entity (Concept, Work, Meeting, Correspondence).
        - FORBIDDEN: Do NOT use "Direct Mentorship" unless you can name the specific Lab, University Department, or Project where it happened as the node.
        - FORBIDDEN: Do NOT use broad movements, schools, or circles (e.g., "Vienna Circle", "Analytic Philosophy", "Rationalism", "British Empiricism") as the primary connecting node if *any* direct intellectual work, paradox, or correspondence exists.
        - FORBIDDEN: Do NOT use "University of X" or "Fellowship at Y" unless they were there at the exact same time and collaborated.

    9. FAMOUS MEETING RULE:
        - Prioritize cases where two famous people finally meet each other in person or by some other direct one-on-one connection.
        - PREFER: Specific events (summits, premieres, dinners, lab meetings) over broad eras or movements.
        - AVOID: Broad eras (e.g., "World War II", "Civil Rights Movement") or shared workplaces (e.g., "Bell Labs", "Hollywood") unless no specific meeting or project exists.
        - Illustrative Example: Alan Turing -> Meeting at Bell Labs (1943) -> Claude Shannon (BETTER than Turing -> World War II -> Shannon).
        - Illustrative Example: Goethe -> Meeting at Teplitz -> Beethoven (BETTER than Goethe -> Romanticism -> Beethoven).
        
    BIPARTITE ENFORCEMENT:
    - If Node A is a Person and Node B is a Person, the intermediary MUST be a COMPOSITE (Event/Work/Concept).
    - It CANNOT be another Person.
    - WRONG: Russell -> Peano -> Frege
    - RIGHT: Russell -> Peano Axioms -> Peano -> Letter to Frege -> Frege
    
    Example valid path:
    Person (Isaac Asimov) -> Event (Star Trek) -> Person (Gene Roddenberry)
    
    Identify a sequence of 1-4 intermediary entities to link "${start}" to "${end}".

    Return JSON:
    {
      "path": [
        { "id": "${start}", "type": "Person", "description": "Short bio", "justification": "Start node", "year": 1950 },
        { "id": "Intermediary 1...", "type": "TV Program/Movie/etc", "description": "...", "justification": "Directly connected to the PREVIOUS node because...", "year": 1965 },
        { "id": "${end}", "type": "Person", "description": "...", "justification": "Directly connected to the PREVIOUS node because...", "year": 1990 }
      ]
    }`;

  try {
    const text = await runJsonCompletion({
      system: SYSTEM_INSTRUCTION,
      user: prompt,
      timeoutMs: 45000,
      attempts: 4,
      gemini: gemini
        ? () =>
            gemini.models.generateContent({
              model: getGeminiModel(),
              contents: prompt,
              config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    path: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          type: { type: Type.STRING },
                          description: { type: Type.STRING },
                          justification: { type: Type.STRING, description: "Relationship to the PREVIOUS node in the chain" },
                          year: { type: Type.INTEGER, nullable: true, description: "Year of occurrence/creation (Required for Events)" }
                        },
                        required: ["id", "type", "description", "justification"]
                      }
                    }
                  },
                  required: ["path"]
                }
              }
            })
        : undefined,
    });
    const json = JSON.parse(cleanJson(text));

    // Ensure the path starts with the start node and ends with the end node
    if (json.path && json.path.length > 0) {
      const first = json.path[0].id.toLowerCase();
      const last = json.path[json.path.length - 1].id.toLowerCase();
      const startLow = start.toLowerCase();
      const endLow = end.toLowerCase();

      // If AI didn't include start/end nodes, prepend/append them
      if (!first.includes(startLow) && !startLow.includes(first)) {
        json.path.unshift({
          id: start,
          type: "Start",
          description: context?.startWiki?.substring(0, 100) || "Start node",
          justification: "Start of path",
          year: null
        });
      }
      if (!last.includes(endLow) && !endLow.includes(last)) {
        json.path.push({
          id: end,
          type: "End",
          description: context?.endWiki?.substring(0, 100) || "End node",
          justification: "Destination",
          year: null
        });
      }
    }

    return json as PathResponse;
  } catch (error) {
    console.error("Gemini Pathfinding Error:", error);
    return { path: [], found: false };
  }
};

export const findWikipediaTitle = async (name: string, description?: string): Promise<{ title: string; imageHint?: string } | null> => {
  if (shouldProxy()) {
    return callAiProxy("/api/ai/title", { name, description });
  }

  const apiKey = await getLlmApiKey();
  if (!apiKey) return null;
  const useGemini = getLlmProvider() === "gemini";
  const gemini = useGemini ? new GoogleGenAI({ apiKey }) : null;

  const prompt = `Find the exact English Wikipedia article title for "${name}"${description ? ` described as "${description}"` : ''}.
    Also, if you know a specific Wikimedia Commons filename for a good portrait of this person/thing, include it.
    
    Return JSON:
    {
      "title": "Exact Wikipedia Title",
      "imageHint": "Optional filename like 'File:Person Name.jpg' or null"
    }`;

  try {
    const text = await runJsonCompletion({
      user: prompt,
      timeoutMs: 10000,
      attempts: 2,
      gemini: gemini
        ? () =>
            gemini.models.generateContent({
              model: getGeminiModel(),
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    imageHint: { type: Type.STRING, nullable: true }
                  },
                  required: ["title"]
                }
              }
            })
        : undefined,
    });
    const json = JSON.parse(cleanJson(text));
    return {
      title: json.title,
      imageHint: json.imageHint
    };
  } catch (e) {
    // console.warn("AI title lookup failed", e);
    return null;
  }
};

// Optional: grounded lookup for org leadership using Google Search tool.
// NOTE: This cannot use responseSchema/responseMimeType; we parse JSON from text.
export const fetchOrgKeyPeopleBlockViaSearch = async (orgName: string): Promise<string | null> => {
  if (shouldProxy()) {
    return callAiProxy("/api/ai/search-org", { orgName });
  }

  // Google Search grounding is Gemini-only in this codebase.
  if (getLlmProvider() !== "gemini") return null;

  const apiKey = await getLlmApiKey();
  if (!apiKey) return null;

  const name = String(orgName || "").trim();
  if (!name) return null;

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Use Google Search to find reputable sources about "${name}".

Goal: extract founders and key leadership/creative roles for the organization/museum/venue.

Return STRICT JSON only (no prose):
{
  "founders": [{"name": "Full Name", "evidence": "Short quote or paraphrase", "sourceUrl": "https://...", "sourceTitle": "Page title"}],
  "keyPeople": [{"name": "Full Name", "role": "Role", "evidence": "Short quote or paraphrase", "sourceUrl": "https://...", "sourceTitle": "Page title"}]
}

Rules:
- Prefer sources that explicitly state founder/creative director/CEO/etc.
- If the founder is not explicitly stated, leave founders empty.
- Only include people that are clearly tied to "${name}" (avoid name collisions).
- If unsure, omit.`;

  try {
    const response = await withRetry(
      () =>
        withTimeout(
          ai.models.generateContent({
            model: getGeminiModel(),
            contents: prompt,
            config: {
              systemInstruction: "You are a careful research assistant. Use Google Search for grounding and do not invent facts.",
              tools: [{ googleSearch: {} }]
            }
          }),
          20000,
          "Org key-people search timed out"
        ),
      4,
      1000
    );

    const text = cleanJson(getResponseText(response));
    if (!text) return null;
    const json = JSON.parse(text) as any;
    const founders = Array.isArray(json?.founders) ? json.founders : [];
    const keyPeople = Array.isArray(json?.keyPeople) ? json.keyPeople : [];

    const f = founders
      .filter((x: any) => x?.name && typeof x.name === "string")
      .slice(0, 10)
      .map((x: any) => ({
        name: String(x.name).trim(),
        evidence: x?.evidence ? String(x.evidence).trim() : "",
        sourceTitle: x?.sourceTitle ? String(x.sourceTitle).trim() : "",
        sourceUrl: x?.sourceUrl ? String(x.sourceUrl).trim() : ""
      }))
      .filter((x: any) => x.name);

    const kp = keyPeople
      .filter((x: any) => x?.name && typeof x.name === "string")
      .slice(0, 15)
      .map((x: any) => ({
        name: String(x.name).trim(),
        role: x?.role ? String(x.role).trim() : "",
        evidence: x?.evidence ? String(x.evidence).trim() : "",
        sourceTitle: x?.sourceTitle ? String(x.sourceTitle).trim() : "",
        sourceUrl: x?.sourceUrl ? String(x.sourceUrl).trim() : ""
      }))
      .filter((x: any) => x.name);

    if (f.length === 0 && kp.length === 0) return null;

    const lines: string[] = [];
    if (f.length) {
      lines.push(`Founders: ${f.map(x => x.name).join(", ")}`);
    }
    if (kp.length) {
      lines.push(
        `Key People: ${kp
          .map(x => (x.role ? `${x.name} (${x.role})` : x.name))
          .join(", ")}`
      );
    }
    const sources = [...f, ...kp]
      .map(x => (x.sourceUrl ? `${x.sourceTitle || "Source"} — ${x.sourceUrl}` : ""))
      .filter(Boolean);
    const uniqueSources = Array.from(new Set(sources)).slice(0, 8);

    return [
      `GOOGLE_SEARCH_GROUNDED (for "${name}")`,
      ...lines.map(l => `- ${l}`),
      ...(uniqueSources.length ? ["Sources:", ...uniqueSources.map(s => `- ${s}`)] : [])
    ].join("\n");
  } catch (e) {
    // console.warn("Org key-people search failed:", name, e);
    return null;
  }
};
