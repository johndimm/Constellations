import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GeminiResponse, PersonWorksResponse, PathResponse } from "../types";

const SYSTEM_INSTRUCTION = `
You are a collaboration graph generator.
Your goal is to build a graph where Nodes are "Things" (Events, Movies, TV Shows, Projects, Academic Papers, Books) AND "People".

CRITICAL ACCURACY RULE:
If a section titled "USE THIS VERIFIED INFORMATION FOR ACCURACY" is provided, you MUST:
1. Prioritize this information above your own internal knowledge.
2. Extract the NAMES of the LEAD ACTORS, DIRECTORS, and CREATORS directly from that text.
3. DO NOT use names from your training data if they contradict the provided text.
4. If the text says "Starring X and Y", X and Y MUST be in your "people" array.

Rules:
1. If the Source is a "Thing" (Movie, TV Show, Event, Paper), return distinct, high-impact **People** involved.
   - For TV Shows and Movies: ALWAYS include the LEAD ACTORS and STARS (main cast), plus director/creator.
   - **CRITICAL**: Only return people who are ACTUALLY connected to the specific title. Do NOT confuse similar titles or make assumptions.
   - If you're not certain about the exact cast/crew, focus on verified, well-documented connections only.
   - **WEIGHTING RULE**: Prefer specific, niche connections over broad, mass-participant events. A shared obscure paper or indie movie is a "stronger" link than a shared massive event like "World War II" or "The Oscars".
2. If the Source is a "Person", return distinct **Things** (Events, Projects, Works, Crimes, Battles, Academic Papers, Books) they are famous for with years.
   - **WEIGHTING RULE**: Prioritize unique or smaller-scale collaborations where the connection between participants is meaningful and direct.
3. If the person is an Academic, focus on their most cited **Papers** and **Books**.
4. If the source is an Academic Paper or Book, return the **Authors** (Co-authorship).
5. **Crucial**: Entities must be SPECIFIC named entities.
6. **Formatting**: Omit leading "The" from Event/Project names unless part of a proper title (e.g., use "Great Depression" instead of "The Great Depression").
7. Use Title Case for all names.
8. **ACCURACY**: Return only factually correct information. Do not hallucinate or guess connections.

Return strict JSON.
`;

// Helper to safely retrieve key from various environment variable standards
const getEnvApiKey = () => {
  let key = "";
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      key = import.meta.env.VITE_API_KEY ||
        // @ts-ignore
        import.meta.env.NEXT_PUBLIC_API_KEY ||
        // @ts-ignore
        import.meta.env.API_KEY ||
        "";
    }
  } catch (e) { }
  if (key) return key;
  try {
    if (typeof process !== 'undefined' && process.env) {
      key = process.env.VITE_API_KEY ||
        process.env.NEXT_PUBLIC_API_KEY ||
        process.env.REACT_APP_API_KEY ||
        process.env.API_KEY ||
        "";
    }
  } catch (e) { }
  return key;
};

// Helper to wrap promise with timeout
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMsg));
    }, ms);

    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(reason => {
        clearTimeout(timer);
        reject(reason);
      });
  });
};

const GEMINI_TIMEOUT_MS = 15000; // 15 seconds

export const classifyEntity = async (term: string): Promise<{ type: string; description: string }> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });

  try {
    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Classify "${term}".
      Return JSON with a "type" field.
      If it is a specific Person (real, fictional, alias, criminal identity, e.g. "Zodiac Killer", "Jack the Ripper"), type = "Person".
      If it is a Movie, Event, Book, Academic Paper, Project, Place, Organization, or generic Concept, type = "Event".`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["Person", "Event"] },
            description: { type: Type.STRING }
          },
          required: ["type", "description"]
        }
      }
    });

    const response = await withTimeout<GenerateContentResponse>(apiCall, 5000, "Classification timed out");
    const text = response.text;
    if (!text) return { type: 'Event', description: '' };
    const json = JSON.parse(text);
    return { type: json.type, description: json.description || '' };
  } catch (error) {
    console.warn("Classification failed, defaulting to Event:", error);
    return { type: 'Event', description: '' };
  }
};

export const fetchConnections = async (nodeName: string, context?: string, excludeNodes: string[] = [], wikiContext?: string): Promise<GeminiResponse> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const contextualPrompt = context
    ? `Analyze: "${nodeName}" specifically in the context of "${context}".`
    : `Analyze: "${nodeName}".`;

  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  const excludePrompt = excludeNodes.length > 0
    ? `\nDO NOT include the following already known connections: ${JSON.stringify(excludeNodes)}. Find NEW high-impact connections.`
    : "";

  try {
    console.log(`🤖 [Gemini] fetchConnections for "${nodeName}"`);
    if (wikiContext) {
      console.log(`📖 [Gemini] FULL Wikipedia context passed to AI:`);
      console.log(wikiContext);
    }
    
    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${contextualPrompt}${wikiPrompt}${excludePrompt}
      1. Identify the 'year' it occurred/started (integer) if applicable (e.g. release year, event date).
      2. Find 5-6 key people connected to it:
         - For TV Shows/Movies: Return the LEAD ACTORS/STARS and director/creator (prioritize main cast).
         - For Academic Papers/Books: Return the primary Authors (Co-authorship).
         - For Events: Return key participants.`,
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

    const response = await withTimeout<GenerateContentResponse>(apiCall, GEMINI_TIMEOUT_MS, "Gemini API request timed out");

    const text = response.text;
    if (!text) return { people: [] };

    const parsed = JSON.parse(text) as GeminiResponse;
    console.log(`✅ [Gemini] Found ${parsed.people.length} people for "${nodeName}":`, parsed.people.map(p => `${p.name} (${p.role})`));
    return parsed;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const fetchPersonWorks = async (personName: string, excludeNodes: string[] = [], wikiContext?: string): Promise<PersonWorksResponse> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const wikiPrompt = wikiContext
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n`
    : "";

  const contextPrompt = excludeNodes.length > 0
    ? `The user graph already contains these nodes connected to ${personName}: ${JSON.stringify(excludeNodes)}. 
       Return 6-8 significant movies, historical events, academic papers, books, or projects that are NOT the ones listed above.
       Focus on fresh, distinct connections.`
    : `List 6-8 DISTINCT, significant movies, historical events, academic papers, books, or projects associated with "${personName}".
       If the person is an academic, list their most cited papers and books. If the person is a criminal or historical figure known for specific acts, list those acts as events.`;

  try {
    console.log(`🤖 [Gemini] fetchPersonWorks for "${personName}"`);
    if (wikiContext) console.log(`📖 [Gemini] Using Wikipedia context (first 100 chars): "${wikiContext.substring(0, 100)}..."`);

    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${wikiPrompt}${contextPrompt}
      Ensure each entry is a different entity. Do NOT duplicate entities.
      Include specific year. Sort by year.`,
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
                  description: { type: Type.STRING },
                  role: { type: Type.STRING },
                  year: { type: Type.INTEGER }
                },
                required: ["entity", "type", "description", "role", "year"]
              }
            }
          },
          required: ["works"]
        }
      }
    });

    const response = await withTimeout<GenerateContentResponse>(apiCall, GEMINI_TIMEOUT_MS, "Gemini API request timed out");

    const text = response.text;
    if (!text) return { works: [] };
    const parsed = JSON.parse(text) as PersonWorksResponse;
    console.log(`✅ [Gemini] Found ${parsed.works.length} works for "${personName}":`, parsed.works.map(w => `${w.entity} (${w.year})`));
    return parsed;
  } catch (error) {
    console.error("Gemini API Error (Person Works):", error);
    throw error;
  }
};

export const fetchConnectionPath = async (start: string, end: string, context?: { startWiki?: string; endWiki?: string }): Promise<PathResponse> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const wikiPrompt = context
    ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:
       - ${start}: ${context.startWiki || "No extra info"}
       - ${end}: ${context.endWiki || "No extra info"}\n`
    : "";

  try {
    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${wikiPrompt}Find a valid connection path between "${start}" and "${end}".
            STRICT RULE: The path MUST follow an alternating sequence (Bipartite structure):
            - A "Person" MUST connect to a "Thing" (Movie, Paper, Event, Project, Book).
            - A "Thing" MUST connect to a "Person".
            - DIRECT connections between two People (e.g. "co-author of") or two Things are FORBIDDEN. You must reveal the hidden internal step (e.g. the specific Paper or Movie they shared).
            
            Adjacent entities must be directly connected (e.g. Person A -> Movie X -> Person B -> Event Y -> Person C).
            Try to keep the path under 6 steps if possible (Six Degrees concept).
            
            WEIGHTING PREFERENCE: 
            Prioritize "niche" or "exclusive" connections. For example, if two people both worked on a specific obscure research paper, that is a much stronger path link than if they both "participated" in a massive event like "World War II" or "The 2024 Olympics". Prefer the most direct and exclusive links possible.
            
            Return the full sequence as an ordered list, starting with "${start}" and ending with "${end}".
            For 'justification', explain the link to the PREVIOUS node in the chain.`,
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
                  year: { type: Type.INTEGER },
                  justification: { type: Type.STRING, description: "Connection to the previous node" }
                },
                required: ["id", "type", "description", "justification"]
              }
            }
          },
          required: ["path"]
        }
      }
    });

    const response = await withTimeout<GenerateContentResponse>(apiCall, 60000, "Pathfinding timed out");
    const text = response.text;
    if (!text) return { path: [] };
    return JSON.parse(text) as PathResponse;

  } catch (error) {
    console.error("Gemini API Error (Pathfinding):", error);
    throw error;
  }
};