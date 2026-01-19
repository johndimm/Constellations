import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, PersonWorksResponse, PathResponse } from "../types";
import { getApiKey, getResponseText, cleanJson, withTimeout, withRetry } from "./aiUtils";

export { getApiKey, getResponseText, cleanJson, withTimeout, withRetry } from "./aiUtils";

const SYSTEM_INSTRUCTION = `
You are a Bipartite Graph Generator.
Your goal is to build a graph that alternates between an "Atomic" type and a "Composite" type.

CRITICAL ACCURACY RULE:
If a section titled "USE THIS VERIFIED INFORMATION FOR ACCURACY" is provided, you MUST prioritize this information above your own internal knowledge.

Rules:
1. If the Source is a Composite, return 8-10 distinct Atomics that are meaningfully connected to it.
2. If the Source is an Atomic, return 8-10 distinct Composites that it is meaningfully connected to.
3. Use Title Case for all names.
4. Return only factually correct information. Do not hallucinate.

Return strict JSON.
`;

// Loosened timeouts to tolerate slower responses without failing immediately.
const GEMINI_TIMEOUT_MS = 60000; // 60 seconds for heavier graph expansions
const CLASSIFY_TIMEOUT_MS = 15000; // 15 seconds for classification

// Model selection (configurable via Vite env vars)
// - VITE_GEMINI_MODEL: used for expansions + pathfinding (default)
// - VITE_GEMINI_MODEL_CLASSIFY: optional override for classification
const GEMINI_MODEL = (import.meta as any)?.env?.VITE_GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_MODEL_CLASSIFY = (import.meta as any)?.env?.VITE_GEMINI_MODEL_CLASSIFY || GEMINI_MODEL;

export type LockedPair = {
  atomicType: string;
  compositeType: string;
};

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
  // String-level safety heuristic (no Wikipedia required):
  // Disambiguated titles like "Discover (Daft Punk album)" must never be treated as Person.
  // Treat common work/media parentheticals as Composite/Event in the temporary Person↔Event model.
  const t = term.trim();
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

  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      type: "Event",
      description: "",
      isAtomic: false,
      atomicType: "Person",
      compositeType: "Event",
      reasoning: "No API key available; defaulting to Person↔Event."
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Choose the bipartite pair for this session based ONLY on the first input: "${term}".
You MUST choose EXACTLY ONE of these pairs:
1) Person ↔ Event
2) Ingredient ↔ Recipe
3) Symptom ↔ Disease

Rules:
- If "${term}" is a person (an individual human), choose Person ↔ Event.
- If "${term}" is a historical event/incident/scandal/battle, choose Person ↔ Event.
- If "${term}" is a named work (album, song, book, novel, film, painting, sculpture, artwork), choose Person ↔ Event and set isAtomic=false and type="Event".
- If "${term}" contains an explicit disambiguator like "(album)" / "(song)" / "(film)" / "(book)", it is NOT a person: choose Person ↔ Event and set isAtomic=false and type="Event".
- If "${term}" is an organization/institution/committee (NOT an individual human), choose Person ↔ Event and set isAtomic=false and type="Event".
- If "${term}" is a symptom (e.g., sore throat, runny nose), choose Symptom ↔ Disease.
- If "${term}" is an ingredient (e.g., pepper, chicken, beef), choose Ingredient ↔ Recipe.
- Otherwise, prefer Person ↔ Event unless it clearly implies Symptom or Ingredient.

Return JSON:
{
  "type": "Person | Event | Ingredient | Recipe | Symptom | Disease",
  "description": "Short 1-sentence description",
  "isAtomic": true/false,
  "atomicType": "Person | Ingredient | Symptom",
  "compositeType": "Event | Recipe | Disease",
  "reasoning": "Brief explanation of the chosen pair and which side the term is on"
}`;

  const makeApiCall = () => ai.models.generateContent({
    model: GEMINI_MODEL_CLASSIFY,
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
        required: ["type", "description", "isAtomic", "atomicType", "compositeType", "reasoning"]
      }
    }
  });

  const response = await withRetry(
    () => withTimeout(makeApiCall(), CLASSIFY_TIMEOUT_MS, "Start-pair classification timed out"),
    2,
    400
  );

  const rawText = getResponseText(response);
  const text = cleanJson(rawText);
  const json = text ? JSON.parse(text) : {};

  // Validate to allowed set; fallback to Person↔Event
  const allowedPairs = new Set([
    "Person|Event",
    "Ingredient|Recipe",
    "Symptom|Disease"
  ]);
  const pairKey = `${json.atomicType}|${json.compositeType}`;
  if (!allowedPairs.has(pairKey)) {
    return {
      type: "Event",
      description: json.description || "",
      isAtomic: false,
      atomicType: "Person",
      compositeType: "Event",
      reasoning: "Model returned an unsupported pair; defaulting to Person↔Event."
    };
  }

  return {
    type: json.type || "Event",
    description: json.description || "",
    isAtomic: !!json.isAtomic,
    atomicType: json.atomicType,
    compositeType: json.compositeType,
    reasoning: json.reasoning || ""
  };
};

export const classifyEntity = async (term: string, wikiContext?: string): Promise<{ 
  type: string; 
  description: string; 
  isAtomic: boolean;
  atomicType?: string;
  compositeType?: string;
  reasoning?: string;
}> => {
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

  // Heuristic override: keep a high-signal default for an ambiguous title
  if (normalized === 'the manhattan project' || normalized === 'manhattan project') {
    return {
      type: 'Event',
      description: 'World War II research and development program that produced the first nuclear weapons.',
      isAtomic: false,
      atomicType: 'Person',
      compositeType: 'Event',
      reasoning: 'Not a person → treat as Event (Composite) in the Person↔Event graph.'
    };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] classifyEntity: No API key found");
    return { type: 'Event', description: '', isAtomic: false };
  }
  console.log(`🧪 [Gemini] classify start`, { term, timeoutMs: CLASSIFY_TIMEOUT_MS });
  const ai = new GoogleGenAI({ apiKey });

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
      - In the Person↔Event pairing, treat organizations as "Event" (Composite), NOT "Person".
      - In the Person↔Event pairing, treat named works (albums, songs, books, novels, films, paintings, artworks) as "Event" (Composite), NOT "Person".
      - If the title explicitly contains a disambiguator like "(album)" / "(film)" / "(book)", it is a work: treat it as "Event" (Composite).
      
      Identify the relevant Bipartite Pair this belongs to (e.g. Actor/Movie, Ingredient/Recipe, Symptom/Disease, Person/Event).
      
      Return JSON:
      {
        "type": "Specific Type (e.g. Symptom)",
        "description": "Short 1-sentence description",
        "isAtomic": true/false,
        "atomicType": "What the atomic side of the pair is called (e.g. Symptom)",
        "compositeType": "What the composite side of the pair is called (e.g. Disease)",
        "reasoning": "Brief explanation of why it is atomic or composite in this bipartite context"
      }`;
    
    console.log("🤖 [Gemini] Classify Prompt:", prompt);

    const makeApiCall = () => ai.models.generateContent({
      model: GEMINI_MODEL_CLASSIFY,
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
          required: ["type", "description", "isAtomic", "atomicType", "compositeType", "reasoning"]
        }
      }
    });

    const response = await withRetry(
      () => withTimeout(makeApiCall(), CLASSIFY_TIMEOUT_MS, "Classification timed out"),
      2,
      400
    );
    
    const rawText = getResponseText(response);
    const text = cleanJson(rawText);
    console.log("Classify response text:", text);
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
    console.warn("Classification failed, defaulting to Event:", error);
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
  compositeType?: string
): Promise<GeminiResponse> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] fetchConnections: No API key found");
    throw new Error("No API key found");
  }
  
  const ai = new GoogleGenAI({ apiKey });

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

  const atomicLabel = atomicType || "ATOMIC entity";
  const compositeLabel = compositeType || "COMPOSITE entity";
  const personOnlyRule =
    (atomicType || "").trim().toLowerCase() === "person"
      ? `\nCRITICAL: The atomic side is "Person" meaning individual human beings only.\n- Return ONLY specific individual people with proper names (e.g., "Jane Doe"), not categories or groups.\n- DO NOT return organizations, institutions, committees, councils, companies, museums, foundations, agencies, or any group entities.\n- DO NOT return generic or collective phrases like "Various Local Artists", "Local Artists", "Staff", "Visitors", "Students", "Members", "Volunteers", "Team", "The Public", "Curators".\n- If you cannot find enough specific individual humans, return fewer.`
      : "";
  const workSourceHint =
    (compositeType || "").trim().toLowerCase() === "event"
      ? `\nIf the Source is a named work (e.g., artwork/painting/sculpture/album/book/film), return people directly connected to the work (creator, depicted subject/model if distinct, commissioners/patrons, notable collectors/owners, curators/restorers/biographers explicitly associated). Do NOT invent names; if only the creator is reliably connected, return only that person.`
      : "";

  try {
    const prompt = `${contextualPrompt}${wikiPrompt}${excludePrompt}
      This is a ${compositeLabel}. 
      Return 8-10 key ${atomicLabel} entities (participants, victims, investigators, stars, ingredients, etc.) that make up this composite.
      ${personOnlyRule}
      ${workSourceHint}

      IMPORTANT: For each returned entity, also provide:
      - wikipediaTitle: the canonical English Wikipedia article title for that entity (use parenthetical disambiguation when needed, e.g. "Euphoria (TV series)", "Prince (musician)").
      - a 1-sentence evidence snippet.
      - If VERIFIED INFORMATION text is provided, the evidence snippet MUST be copied verbatim from that text and should contain BOTH the source title and the returned entity name when possible.
      - Set evidencePageTitle to the Wikipedia article title the snippet is from (usually the source).
      - If you cannot find a good verbatim quote in VERIFIED INFORMATION, still return evidenceSnippet as a brief, explicit rationale (no quotes) and set evidencePageTitle to the most relevant page title (usually the source).
      
      Examples:
      - If Event/Incident: Return key people involved (victims, shooters, investigators).
      - If Movie: Return lead actors/director.
      - If Team: Return key players.
      - If Recipe: Return ingredients.
      - If Disease: Return symptoms.`;
    
    console.log(`🤖 [Gemini] fetchConnections Prompt for "${nodeName}":`, prompt);
    
    const makeApiCall = () => ai.models.generateContent({
      model: GEMINI_MODEL,
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
                  wikipediaTitle: { type: Type.STRING, description: "Canonical English Wikipedia article title for this entity (use disambiguation parentheses when needed)" },
                  role: { type: Type.STRING, description: "Role in the requested Source Node" },
                  description: { type: Type.STRING, description: "Short 1-sentence bio" },
                  evidenceSnippet: { type: Type.STRING, description: "1 sentence evidence; if VERIFIED INFORMATION is provided, prefer verbatim from it" },
                  evidencePageTitle: { type: Type.STRING, description: "Wikipedia page title where the snippet came from (usually the source)" }
                },
                required: ["name", "role", "description", "evidenceSnippet", "evidencePageTitle"]
              }
            }
          },
          required: ["people"]
        }
      }
    });

    const response = await withRetry(
      () => withTimeout(makeApiCall(), GEMINI_TIMEOUT_MS, "Gemini API request timed out"),
      2,
      600
    );

    const rawText = getResponseText(response);
    const text = cleanJson(rawText);
    if (!text) return { people: [] };

    const parsed = JSON.parse(text) as GeminiResponse;
    return parsed;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const fetchPersonWorks = async (
  nodeName: string, 
  excludeNodes: string[] = [], 
  wikiContext?: string, 
  wikipediaId?: string,
  atomicType?: string,
  compositeType?: string
): Promise<PersonWorksResponse> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] fetchPersonWorks: No API key found");
    throw new Error("No API key found");
  }
  
  const ai = new GoogleGenAI({ apiKey });

  const wikiIdStr = wikipediaId ? ` (Wikipedia ID: ${wikipediaId})` : "";
  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  const atomicLabel = atomicType || "ATOMIC entity";
  const compositeLabel = compositeType || "COMPOSITE entity";

  const contextPrompt = excludeNodes.length > 0
    ? `The user graph already contains these nodes connected to ${nodeName}${wikiIdStr}: ${JSON.stringify(excludeNodes)}. 
       Return 8-10 NEW significant ${compositeLabel} entities.`
    : `List 8-10 DISTINCT, significant ${compositeLabel} entities that this ${atomicLabel} "${nodeName}"${wikiIdStr} belongs to or is part of.
       
       CRITICAL: A ${compositeLabel} must be a named organization, team, project, work, recipe, disease, or specific historical event/incident. 
       DO NOT return descriptive phrases, facts, or achievements.

       SPECIAL CASE (art): If "${nodeName}" is an artist (painter/sculptor/architect/photographer), include their major named artworks as returned entities.
       - These artworks may be primarily made by a single person; that is OK.
       - Set the returned item's "type" field to "Artwork" (or "Architecture" / "Sculpture" / "Painting" when clearly applicable).
       - ALSO include a few multi-person art-world composites when applicable (e.g., key exhibitions featuring the artist, major movements the artist is associated with, or well-known patronage/collector contexts) to avoid dead-end single-person works.
       - If you include those, set their type to "Event" or "Exhibition" or "Movement" as appropriate.
       - QUOTA: For an artist, return AT LEAST 6 specific named works by the artist (paintings, sculptures, buildings, photo series).
       - Movements/periods/styles (e.g., "Impressionism", "Modernism") must be at most 1 item total, and only if you also returned >=6 works.
       - Do NOT return only movements/periods/styles; the primary goal is to list the artist's works.
       - Prefer the artist's works over generic groupings. For painters, return paintings/series by name (e.g., "Water Lilies", "Impression, Sunrise", "Haystacks", "Rouen Cathedral series").

       SPECIAL CASE (academia/math): If "${nodeName}" is a mathematician/scientist/researcher, include major named papers (often coauthored).
       - Papers are valid ${compositeLabel} in this system.
       - Prefer coauthored papers when possible (they connect to multiple people).
       - Set the returned item's "type" to "Paper" when returning papers.

       IMPORTANT: For each returned entity, also provide:
       - wikipediaTitle: the canonical English Wikipedia article title for that entity (use parenthetical disambiguation when needed, e.g. "Euphoria (TV series)", "The Godfather", "A Streetcar Named Desire (1951 film)").
       - a 1-sentence evidence snippet.
       - If VERIFIED INFORMATION text is provided, the evidence snippet MUST be copied verbatim from that text and should contain BOTH the source name and the returned entity name when possible.
       - Set evidencePageTitle to the Wikipedia article title the snippet is from (usually the source).
       - If you cannot find a good verbatim quote in VERIFIED INFORMATION, still return evidenceSnippet as a brief, explicit rationale (no quotes) and set evidencePageTitle to the most relevant page title (usually the source).
       
       Examples:
       - For a Person involved in a recent event: Return the named Event or Incident (e.g. "Killing of Renee Good", "2026 Minneapolis Protests").
       - For an Ingredient (e.g. "Chicken"): Return specific Recipes.
       - For a Player: Return specific Teams.
       - For an Actor: Return specific Movies.
       - For an Artist: Return specific major Artworks (e.g., "Mona Lisa", "The Last Supper") and optionally a few key Exhibitions/Movements.
       - For a Mathematician: Return specific named Papers (often coauthored).`;

  try {
    const prompt = `${wikiPrompt}${contextPrompt}
      Ensure each entry is a different entity. Sort by year if applicable.`;
    
    console.log(`🤖 [Gemini] fetchPersonWorks Prompt for "${nodeName}":`, prompt);

    const makeApiCall = () => ai.models.generateContent({
      model: GEMINI_MODEL,
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
                  wikipediaTitle: { type: Type.STRING, description: "Canonical English Wikipedia article title for this entity (use disambiguation parentheses when needed)" },
                  type: { type: Type.STRING },
                  description: { type: Type.STRING, description: "Short 1-sentence description" },
                  role: { type: Type.STRING, nullable: true },
                  year: { type: Type.INTEGER, nullable: true },
                  evidenceSnippet: { type: Type.STRING, description: "1 sentence evidence; if VERIFIED INFORMATION is provided, prefer verbatim from it" },
                  evidencePageTitle: { type: Type.STRING, description: "Wikipedia page title where the snippet came from (usually the source)" }
                },
                required: ["entity", "type", "description", "evidenceSnippet", "evidencePageTitle"]
              }
            }
          },
          required: ["works"]
        }
      }
    });

    const response = await withRetry(
      () => withTimeout(makeApiCall(), GEMINI_TIMEOUT_MS, "Gemini API request timed out"),
      2,
      600
    );

    const rawText = getResponseText(response);
    const text = cleanJson(rawText);
    if (!text) return { works: [] };
    const parsed = JSON.parse(text) as PersonWorksResponse;
    return parsed;
  } catch (error) {
    console.error("Gemini API Error (Person Works):", error);
    throw error;
  }
};

export const fetchConnectionPath = async (start: string, end: string, context?: { startWiki?: string; endWiki?: string }): Promise<PathResponse> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] fetchConnectionPath: No API key found");
    throw new Error("No API key found");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const wikiPrompt = (context?.startWiki || context?.endWiki)
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${context?.startWiki ? `[${start}]: ${context.startWiki}\n` : ''}${context?.endWiki ? `[${end}]: ${context.endWiki}\n` : ''}`
    : "";

  const prompt = `Find a connection path between "${start}" and "${end}".
    ${wikiPrompt}
    
    Your goal is to find the most direct and historically significant connection path.
    
    CRITICAL RULES:
    1. The path must ALTERNATE between "Person" and "Event" (where "Event" includes organizations, works, projects, places, etc.; anything that is not a person).
    2. A "Person" MUST NOT be connected directly to another "Person".
    3. An "Event" MUST NOT be connected directly to another "Event".
    4. Each step must be a direct and verifiable collaboration, affiliation, or relationship.
    5. The path must be a continuous chain where each node is connected to the next.
    
    Example valid path:
    Person (Isaac Asimov) -> Event (Star Trek) -> Person (Gene Roddenberry)
    
    Identify a sequence of 1-4 intermediary entities to link "${start}" to "${end}".

    Return JSON:
    {
      "path": [
        { "id": "${start}", "type": "Person/Organization/etc", "description": "Short bio", "justification": "Start node" },
        { "id": "Intermediary 1 (A Thing if Start is Person, Person if Start is Thing)", "type": "...", "description": "...", "justification": "Relationship to previous step" },
        { "id": "Intermediary 2 (A Person if Prev is Thing, Thing if Prev is Person)", "type": "...", "description": "...", "justification": "Relationship to previous step" },
        { "id": "${end}", "type": "...", "description": "...", "justification": "Relationship to previous step" }
      ]
    }`;

  try {
    const response = await withTimeout(ai.models.generateContent({
      model: GEMINI_MODEL,
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
                  year: { type: Type.INTEGER, nullable: true }
                },
                required: ["id", "type", "description", "justification"]
              }
            }
          },
          required: ["path"]
        }
      }
    }), 45000, "Pathfinding timed out");

    const text = getResponseText(response);
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
          justification: "Start of path"
        });
      }
      if (!last.includes(endLow) && !endLow.includes(last)) {
        json.path.push({
          id: end,
          type: "End",
          description: context?.endWiki?.substring(0, 100) || "End node",
          justification: "Destination"
        });
      }
    }

    return json as PathResponse;
  } catch (error) {
    console.error("Gemini Pathfinding Error:", error);
    throw error;
  }
};

export const findWikipediaTitle = async (name: string, description?: string): Promise<{ title: string; imageHint?: string } | null> => {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `Find the exact English Wikipedia article title for "${name}"${description ? ` described as "${description}"` : ''}.
    Also, if you know a specific Wikimedia Commons filename for a good portrait of this person/thing, include it.
    
    Return JSON:
    {
      "title": "Exact Wikipedia Title",
      "imageHint": "Optional filename like 'File:Person Name.jpg' or null"
    }`;
    
  try {
    const response = await withTimeout(ai.models.generateContent({
      model: "gemini-2.0-flash",
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
    }), 10000, "Title lookup timed out");
    
    const text = getResponseText(response);
    const json = JSON.parse(cleanJson(text));
    return {
      title: json.title,
      imageHint: json.imageHint
    };
  } catch (e) {
    console.warn("AI title lookup failed", e);
    return null;
  }
};
