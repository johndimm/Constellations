import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GeminiResponse, PersonWorksResponse } from "../types";

const SYSTEM_INSTRUCTION = `
You are a collaboration graph generator.
Your goal is to build a graph where Nodes are "Things" (Events, Movies, Projects) AND "People".

Rules:
1. If the Source is a "Thing" (Movie, Event), return distinct, high-impact **People** involved.
2. If the Source is a "Person", return distinct **Things** (Events, Projects, Works, Crimes, Battles) they are famous for with years.
3. **Crucial**: Entities must be SPECIFIC named entities.

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
    } catch (e) {}
    if (key) return key;
    try {
        if (typeof process !== 'undefined' && process.env) {
            key = process.env.VITE_API_KEY || 
                  process.env.NEXT_PUBLIC_API_KEY || 
                  process.env.REACT_APP_API_KEY || 
                  process.env.API_KEY || 
                  "";
        }
    } catch (e) {}
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

export const classifyEntity = async (term: string): Promise<string> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });

  try {
    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Classify "${term}".
      Return JSON with a "type" field.
      If it is a specific Person (real, fictional, alias, criminal identity, e.g. "Zodiac Killer", "Jack the Ripper"), type = "Person".
      If it is a Movie, Event, Book, Project, Place, Organization, or generic Concept, type = "Event".`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["Person", "Event"] }
          },
          required: ["type"]
        }
      }
    });

    const response = await withTimeout<GenerateContentResponse>(apiCall, 5000, "Classification timed out");
    const text = response.text;
    if (!text) return 'Event';
    const json = JSON.parse(text);
    return json.type;
  } catch (error) {
    console.warn("Classification failed, defaulting to Event:", error);
    return 'Event';
  }
};

export const fetchConnections = async (nodeName: string): Promise<GeminiResponse> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Analyze: "${nodeName}".
      1. Identify the 'year' it occurred/started (integer) if applicable (e.g. release year, event date).
      2. Find 5-6 key people connected to it.`,
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
    
    return JSON.parse(text) as GeminiResponse;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const fetchPersonWorks = async (personName: string, existingNodes: string[] = []): Promise<PersonWorksResponse> => {
  const apiKey = getEnvApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const contextPrompt = existingNodes.length > 0 
    ? `The user graph already contains these nodes connected to ${personName}: ${JSON.stringify(existingNodes)}. 
       Return 6-8 significant movies, historical events, crimes, battles, or projects.
       Include the existing ones if relevant (to ensure correct metadata), plus new ones.`
    : `List 6-8 DISTINCT, significant movies, historical events, crimes, battles, or projects associated with "${personName}".
       If the person is a criminal or historical figure known for specific acts, list those acts as events.`;

  try {
    const apiCall = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${contextPrompt}
      Ensure each entry is a different entity. Do NOT duplicate entities.
      Include specific year. Sort by year.`,
      config: {
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
    return JSON.parse(text) as PersonWorksResponse;
  } catch (error) {
    console.error("Gemini API Error (Person Works):", error);
    throw error;
  }
};