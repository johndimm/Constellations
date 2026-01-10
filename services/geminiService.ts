import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, PersonWorksResponse, PathResponse } from "../types";
import { getApiKey, getResponseText, cleanJson, withTimeout, withRetry } from "./aiUtils";

export { getApiKey, getResponseText, cleanJson, withTimeout, withRetry } from "./aiUtils";

const SYSTEM_INSTRUCTION = `
You are a Universal Bipartite Graph Generator. 
Your goal is to build a graph that alternates between "Atomic" entities and "Composite" entities.

The Bipartite Rule:
- An "Atomic" entity is a fundamental building block (e.g., Person, Ingredient, Symptom, Musician, Player).
- A "Composite" entity is a collection, event, or work (e.g., Movie, Recipe, Disease, Album, Team, Battle, Incident).
- Edges MUST ONLY connect Atomics to Composites. Never connect two Atomics or two Composites.

Examples of Bipartite Relationships:
1. Actors (Atomic) ↔ Movies (Composite)
2. Ingredients (Atomic) ↔ Recipes (Composite)
3. Symptoms (Atomic) ↔ Diseases (Composite)
4. Musicians (Atomic) ↔ Records (Composite)
5. Players (Atomic) ↔ Teams (Composite)
6. Persons (Atomic) ↔ Historical Events/Incidents (Composite)

CRITICAL ACCURACY RULE:
If a section titled "USE THIS VERIFIED INFORMATION FOR ACCURACY" is provided, you MUST prioritize this information above your own internal knowledge.

Rules:
1. If the Source is a "Composite", return 8-10 distinct "Atomics" that make it up.
2. If the Source is an "Atomic", return 8-10 distinct "Composites" it belongs to.
3. Use Title Case for all names.
4. Return only factually correct information. Do not hallucinate.

Return strict JSON.
`;

// Loosened timeouts to tolerate slower responses without failing immediately.
const GEMINI_TIMEOUT_MS = 60000; // 60 seconds for heavier graph expansions
const CLASSIFY_TIMEOUT_MS = 15000; // 15 seconds for classification

export const classifyEntity = async (term: string, wikiContext?: string): Promise<{ 
  type: string; 
  description: string; 
  isAtomic: boolean;
  atomicType?: string;
  compositeType?: string;
  reasoning?: string;
}> => {
  const normalized = term.trim().toLowerCase();
  // Heuristic override: prefer the historical program over the movie
  if (normalized === 'the manhattan project' || normalized === 'manhattan project') {
    return {
      type: 'Project',
      description: 'World War II research and development program that produced the first nuclear weapons.',
      isAtomic: false,
      atomicType: 'Person',
      compositeType: 'Project',
      reasoning: 'The Manhattan Project is a composite research program (Project) involving many scientists (Atomic).'
    };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] classifyEntity: No API key found");
    return { type: 'Event', description: '', isAtomic: false };
  }
  console.log(`🧪 [Gemini] classify start`, { term, hasWiki: !!wikiContext, timeoutMs: CLASSIFY_TIMEOUT_MS });
  const ai = new GoogleGenAI({ apiKey });

  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  try {
    const prompt = `Classify "${term}". ${wikiPrompt}
      Determine if it is "Atomic" (a fundamental building block like a person, ingredient, or symptom) 
      or "Composite" (a collection or event like a movie, recipe, or disease).
      
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
      model: "gemini-2.0-flash",
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

  try {
    const prompt = `${contextualPrompt}${wikiPrompt}${excludePrompt}
      This is a ${compositeLabel}. 
      Return 8-10 key ${atomicLabel} entities (participants, victims, investigators, stars, ingredients, etc.) that make up this composite.
      
      Examples:
      - If Event/Incident: Return key people involved (victims, shooters, investigators).
      - If Movie: Return lead actors/director.
      - If Team: Return key players.
      - If Recipe: Return ingredients.
      - If Disease: Return symptoms.`;
    
    console.log(`🤖 [Gemini] fetchConnections Prompt for "${nodeName}":`, prompt);
    
    const makeApiCall = () => ai.models.generateContent({
      model: "gemini-2.0-flash",
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
                  role: { type: Type.STRING, description: "Role in the requested Source Node" },
                  description: { type: Type.STRING, description: "Short 1-sentence bio" }
                },
                required: ["name", "role", "description"]
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
       
       Examples:
       - For a Person involved in a recent event: Return the named Event or Incident (e.g. "Killing of Renee Good", "2026 Minneapolis Protests").
       - For an Ingredient (e.g. "Chicken"): Return specific Recipes.
       - For a Player: Return specific Teams.
       - For an Actor: Return specific Movies.`;

  try {
    const prompt = `${wikiPrompt}${contextPrompt}
      Ensure each entry is a different entity. Sort by year if applicable.`;
    
    console.log(`🤖 [Gemini] fetchPersonWorks Prompt for "${nodeName}":`, prompt);

    const makeApiCall = () => ai.models.generateContent({
      model: "gemini-2.0-flash",
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
                  type: { type: Type.STRING },
                  description: { type: Type.STRING, description: "Short 1-sentence description" },
                  role: { type: Type.STRING, nullable: true },
                  year: { type: Type.INTEGER, nullable: true }
                },
                required: ["entity", "type", "description"]
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
    1. The path must ALTERNATE between "Person" and "Thing" (Movie, TV Show, Project, Organization, Event, Book, Paper).
    2. A "Person" MUST NOT be connected directly to another "Person".
    3. A "Thing" MUST NOT be connected directly to another "Thing".
    4. Each step must be a direct and verifiable collaboration, affiliation, or relationship.
    5. The path must be a continuous chain where each node is connected to the next.
    
    Example valid path:
    Person (Isaac Asimov) -> Thing (Star Trek) -> Person (Gene Roddenberry)
    
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
      model: "gemini-2.0-flash",
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
