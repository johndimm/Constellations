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

const getEnvApiKey = () => {
  // Local storage fallback (manual entry)
  try {
    const stored = (typeof localStorage !== 'undefined') 
      ? (localStorage.getItem('GEMINI_API_KEY') || localStorage.getItem('VITE_GEMINI_API_KEY') || localStorage.getItem('API_KEY'))
      : "";
    if (stored && stored.length > 5) return stored;
  } catch (e) {}

  // Querystring/global bridge fallback (browser only)
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlKey = params.get('key') || params.get('apiKey') || params.get('geminiKey');
      if (urlKey && urlKey.length > 5) {
        try {
          localStorage.setItem('GEMINI_API_KEY', urlKey);
          localStorage.setItem('VITE_GEMINI_API_KEY', urlKey);
          localStorage.setItem('API_KEY', urlKey);
        } catch (e) {}
        return urlKey;
      }

      const globalKey = (window as any).__GEMINI_API_KEY__ || (window as any).__API_KEY__ || (window as any).GEMINI_API_KEY;
      if (globalKey && globalKey.length > 5) return globalKey;
    }
  } catch (e) {}

  // Check common Vite environment variables
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    // @ts-ignore
    const k = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || import.meta.env.GEMINI_API_KEY;
    if (k && k.length > 5) return k;
  }

  // Check process.env (mapped via vite.config.ts define)
  try {
    // @ts-ignore
    const k = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (k && k.length > 5 && k !== "process.env.GEMINI_API_KEY") return k;
  } catch (e) {}

  return "";
};

const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }).catch(reason => { clearTimeout(timer); reject(reason); });
  });
};

const GEMINI_TIMEOUT_MS = 30000;

const MODELS = [
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-2.0-flash-lite-preview-02-05",
  "gemini-1.5-flash-8b"
];

const callGeminiWithRetry = async <T>(
  nodeName: string,
  apiCallFn: (modelName: string) => Promise<T>,
  maxTries: number = 3
): Promise<T> => {
  const apiKey = getEnvApiKey();
  if (!apiKey) {
    console.error("❌ [Gemini] NO API KEY FOUND in any environment variable (GEMINI_API_KEY, VITE_API_KEY, etc.)");
    throw new Error("An API Key must be set when running in a browser. Please check your .env.local file.");
  }

  let lastError: any;
  for (let i = 0; i < maxTries; i++) {
    const modelName = MODELS[i % MODELS.length];
    try {
      console.log(`📡 [Gemini] Attempt ${i + 1} using model: ${modelName} for "${nodeName}"`);
      return await apiCallFn(modelName);
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);
      console.warn(`⚠️ [Gemini] Attempt ${i + 1} failed with ${modelName}:`, errorMsg);
      
      const isQuotaError = errorMsg.includes("429") || errorMsg.includes("quota");
      if (i < maxTries - 1) {
        const waitTime = isQuotaError ? 2000 : 1500;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  throw lastError;
};

export const classifyEntity = async (term: string): Promise<{ type: string; description: string }> => {
  const apiKey = getEnvApiKey();
  const genAI = new GoogleGenAI(apiKey);

  return callGeminiWithRetry(term, async (modelName) => {
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
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
    }, { apiVersion: 'v1beta' });

    const result = await withTimeout(model.generateContent(`Classify "${term}".
      Return JSON with a "type" field.
      If it is a specific Person (real, fictional, alias, criminal identity, e.g. "Zodiac Killer", "Jack the Ripper"), type = "Person".
      If it is a Movie, Event, Book, Academic Paper, Project, Place, Organization, or generic Concept, type = "Event".`), 5000, "Classification timed out");
    
    const text = result.response.text();
    if (!text) return { type: 'Event', description: '' };
    const json = JSON.parse(text);
    return { type: json.type, description: json.description || '' };
  });
};

export const fetchConnections = async (nodeName: string, context?: string, excludeNodes: string[] = [], wikiContext?: string): Promise<GeminiResponse> => {
  const apiKey = getEnvApiKey();
  const genAI = new GoogleGenAI(apiKey);

  const contextualPrompt = context ? `Analyze: "${nodeName}" specifically in the context of "${context}".` : `Analyze: "${nodeName}".`;
  const wikiPrompt = wikiContext ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n` : "";
  const excludePrompt = excludeNodes.length > 0 ? `\nDO NOT include the following already known connections: ${JSON.stringify(excludeNodes)}. Find NEW high-impact connections.` : "";

  return callGeminiWithRetry(nodeName, async (modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
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
    }, { apiVersion: 'v1beta' });

    const result = await withTimeout(model.generateContent(`${contextualPrompt}${wikiPrompt}${excludePrompt}
      1. Identify the 'year' it occurred/started (integer) if applicable (e.g. release year, event date).
      2. Find 5-6 key people connected to it:
         - For TV Shows/Movies: Return the LEAD ACTORS/STARS and director/creator (prioritize main cast).
         - For Academic Papers/Books: Return the primary Authors (Co-authorship).
         - For Events: Return key participants.`), GEMINI_TIMEOUT_MS, "Gemini API request timed out");

    const text = result.response.text();
    if (!text) return { people: [] };
    const parsed = JSON.parse(text) as GeminiResponse;
    console.log(`✅ [Gemini] Found ${parsed.people.length} people for "${nodeName}":`, parsed.people.map(p => `${p.name} (${p.role})`));
    return parsed;
  });
};

export const fetchPersonWorks = async (personName: string, excludeNodes: string[] = [], wikiContext?: string): Promise<PersonWorksResponse> => {
  const apiKey = getEnvApiKey();
  const genAI = new GoogleGenAI(apiKey);

  const wikiPrompt = wikiContext ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:\n${wikiContext}\n` : "";
  const contextPrompt = excludeNodes.length > 0
    ? `The user graph already contains these nodes connected to ${personName}: ${JSON.stringify(excludeNodes)}. 
       Return 6-8 significant movies, historical events, academic papers, books, or projects that are NOT the ones listed above.
       Focus on fresh, distinct connections.`
    : `List 6-8 DISTINCT, significant movies, historical events, academic papers, books, or projects associated with "${personName}".
       If the person is an academic, list their most cited papers and books. If the person is a criminal or historical figure known for specific acts, list those acts as events.`;

  return callGeminiWithRetry(personName, async (modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
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
    }, { apiVersion: 'v1beta' });

    const result = await withTimeout(model.generateContent(`${wikiPrompt}${contextPrompt}
      Ensure each entry is a different entity. Do NOT duplicate entities.
      Include specific year. Sort by year.`), GEMINI_TIMEOUT_MS, "Gemini API request timed out");

    const text = result.response.text();
    if (!text) return { works: [] };
    const parsed = JSON.parse(text) as PersonWorksResponse;
    console.log(`✅ [Gemini] Found ${parsed.works.length} works for "${personName}":`, parsed.works.map(w => `${w.entity} (${w.year})`));
    return parsed;
  });
};

export const fetchConnectionPath = async (start: string, end: string, context?: { startWiki?: string; endWiki?: string }): Promise<PathResponse> => {
  const apiKey = getEnvApiKey();
  const genAI = new GoogleGenAI(apiKey);

  const wikiPrompt = context ? `\n\nUSE THIS VERIFIED INFORMATION FOR ACCURACY:
       - ${start}: ${context.startWiki || "No extra info"}
       - ${end}: ${context.endWiki || "No extra info"}\n` : "";

  return callGeminiWithRetry(`${start} -> ${end}`, async (modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
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
    }, { apiVersion: 'v1beta' });

    const result = await withTimeout(model.generateContent(`${wikiPrompt}Find a valid connection path between "${start}" and "${end}".
            STRICT RULE: The path MUST follow an alternating sequence (Bipartite structure):
            - A "Person" MUST connect to a "Thing" (Movie, Paper, Event, Project, Book).
            - A "Thing" MUST connect to a "Person".
            - DIRECT connections between two People (e.g. "co-author of") or two Things are FORBIDDEN. You must reveal the hidden internal step (e.g. the specific Paper or Movie they shared).
            
            Adjacent entities must be directly connected (e.g. Person A -> Movie X -> Person B -> Event Y -> Person C).
            Try to keep the path under 6 steps if possible (Six Degrees concept).
            
            WEIGHTING PREFERENCE: 
            Prioritize "niche" or "exclusive" connections. For example, if two people both worked on a specific obscure research paper, that is a much stronger path link than if they both "participated" in a massive event like "World War II" or "The 2024 Olympics". Prefer the most direct and exclusive links possible.
            
            Return the full sequence as an ordered list, starting with "${start}" and ending with "${end}".
            For 'justification', explain the link to the PREVIOUS node in the chain.`), 90000, "Pathfinding timed out");

    const text = result.response.text();
    if (!text) return { path: [] };
    return JSON.parse(text) as PathResponse;
  });
};
