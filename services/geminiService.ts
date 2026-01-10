import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, PersonWorksResponse, PathResponse } from "../types";
import { getApiKey, getResponseText, cleanJson, withTimeout, withRetry } from "./aiUtils";

export { getApiKey, getResponseText, cleanJson, withTimeout, withRetry } from "./aiUtils";

const SYSTEM_INSTRUCTION = `
You are a collaboration graph generator.
Your goal is to build a graph where Nodes are "Things" (Events, Movies, TV Shows, Projects, Academic Papers, Books, Organizations, Research Centers) AND "People".

CRITICAL ACCURACY RULE:
If a section titled "USE THIS VERIFIED INFORMATION FOR ACCURACY" is provided, you MUST:
1. Prioritize this information above your own internal knowledge.
2. Extract the NAMES of the LEAD ACTORS, DIRECTORS, and CREATORS directly from that text.
3. DO NOT use names from your training data if they contradict the provided text.
4. If the text says "Starring X and Y", X and Y MUST be in your "people" array.

Rules:
1. If the Source is a "Thing" (Movie, TV Show, Event, Paper, Project, Organization), return distinct, high-impact **People** involved.
   - For TV Shows and Movies: ALWAYS include the LEAD ACTORS and STARS (main cast), plus director/creator.
   - For Organizations/Research Centers: Include founders, directors, and famous members or researchers.
   - For Events/Investigations: Include key participants, investigators, leaders, and primary figures mentioned in historical or news records.
   - **CRITICAL**: Only return people who are ACTUALLY connected to the specific title. Do NOT confuse similar titles or make assumptions.
   - If you're not certain about the exact cast/crew, focus on verified, well-documented connections only.
   - **WEIGHTING RULE**: Prefer specific, niche connections over broad, mass-participant events. A shared obscure paper or indie movie is a "stronger" link than a shared massive event like "World War II" or "The Oscars".
2. If the Source is a "Person", return distinct **Things** (Events, Projects, Works, Organizations, Academic Papers, Books) they are famous for with years.
   - **WEIGHTING RULE**: Prioritize unique or smaller-scale collaborations where the connection between participants is meaningful and direct.
3. If the person is an Academic, focus on their most cited **Papers**, **Books**, and **Research Centers** they worked at.
4. If the source is an Academic Paper or Book, return the **Authors** (Co-authorship).
5. **Crucial**: Entities must be SPECIFIC named entities.
6. **Formatting**: Omit leading "The" from Event/Project names unless part of a proper title (e.g., use "Great Depression" instead of "The Great Depression").
7. Use Title Case for all names.
8. **ACCURACY**: Return only factually correct information. Do not hallucinate or guess connections.

Return strict JSON.
`;

// Loosened timeouts to tolerate slower responses without failing immediately.
const GEMINI_TIMEOUT_MS = 60000; // 60 seconds for heavier graph expansions
const CLASSIFY_TIMEOUT_MS = 15000; // 15 seconds for classification

export const classifyEntity = async (term: string): Promise<{ 
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
  console.log(`🧪 [Gemini] classify start`, { term, timeoutMs: CLASSIFY_TIMEOUT_MS });
  const ai = new GoogleGenAI({ apiKey });

  try {
    const prompt = `Classify "${term}". 
      Determine if it is "Atomic" (a fundamental building block like a person, ingredient, or symptom) 
      or "Composite" (a collection or event like a movie, recipe, or disease).
      
      Identify the relevant Bipartite Pair this belongs to (e.g. Actor/Movie, Ingredient/Recipe, Symptom/Disease).
      
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

export const fetchConnections = async (nodeName: string, context?: string, excludeNodes: string[] = [], wikiContext?: string, wikipediaId?: string): Promise<GeminiResponse> => {
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

  try {
    const prompt = `${contextualPrompt}${wikiPrompt}${excludePrompt}
      This is a COMPOSITE entity. 
      Return 8-10 key ATOMIC entities (building blocks, participants, ingredients, etc.) that make up this composite.
      
      Examples:
      - If Movie: Return lead actors/director.
      - If Team: Return key players.
      - If Recipe: Return ingredients.
      - If Disease: Return symptoms.
      - If Event: Return primary figures.`;
    
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

export const fetchPersonWorks = async (nodeName: string, excludeNodes: string[] = [], wikiContext?: string, wikipediaId?: string): Promise<PersonWorksResponse> => {
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

  const contextPrompt = excludeNodes.length > 0
    ? `The user graph already contains these nodes connected to ${nodeName}${wikiIdStr}: ${JSON.stringify(excludeNodes)}. 
       Return 8-10 NEW significant COMPOSITE entities.`
    : `List 8-10 DISTINCT, significant COMPOSITE entities that this ATOMIC entity "${nodeName}"${wikiIdStr} belongs to or is part of.
       
       CRITICAL: A COMPOSITE entity must be a named organization, team, project, or work. 
       DO NOT return descriptive phrases, facts, or achievements (e.g., do NOT return "Scoring Record" or "Best Defense").
       
       Examples:
       - For a Player: Return their specific Teams (e.g., "Miami Heat").
       - For an Actor: Return their Movies.
       - For an Ingredient: Return specific Recipes.
       - For a Symptom: Return specific Diseases.`;

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
