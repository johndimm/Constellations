import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, PersonWorksResponse } from "../types";

const SYSTEM_INSTRUCTION = `
You are a collaboration graph generator exploring history, pop culture, and current events.
Your goal is to build a graph where Nodes are "Things" (Events, Projects, Movies, Battles, Administrations, Companies, etc.) and Edges are "People" who participated in both connected things.

When the user provides a Node name (e.g., "The Godfather", "Watergate Scandal", "Trump's Second Administration"):
1. Identify 12-15 distinct, high-impact people involved in that Node.
   - For Movies: Actors, Director, Writer.
   - For Political Administrations (especially "Trump's Second Administration"): List key cabinet nominees, appointees, and top advisors (e.g., Elon Musk, Vivek Ramaswamy, Susie Wiles, Marco Rubio, Pete Hegseth, Tulsi Gabbard).
   - For Historical Events: Key figures, generals, leaders.

2. For each person, identify ONE other specific, significant "Thing" (Node) they are famous for collaborating on or participating in.
   - Crucial: The "connectedEntity" must be a specific named event/project/work/company (e.g., "SpaceX", "The Apprentice", "PayPal", "U.S. Senate", "Fox News").
   - Provide a short 1-sentence description of the connected entity.

Return the data in strict JSON format.
`;

export const fetchConnections = async (nodeName: string): Promise<GeminiResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Find connections for the node: "${nodeName}"`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            connections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  personName: { type: Type.STRING },
                  personRole: { type: Type.STRING, description: "Role of the person in the specific connected entity" },
                  connectedEntity: { type: Type.STRING, description: "The name of the other node" },
                  connectedEntityType: { type: Type.STRING, description: "Type of the other node (e.g. Movie, Administration)" },
                  entityDescription: { type: Type.STRING, description: "Short description of the connected entity" }
                },
                required: ["personName", "personRole", "connectedEntity", "connectedEntityType", "entityDescription"]
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return { connections: [] };
    
    return JSON.parse(text) as GeminiResponse;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const fetchPersonWorks = async (personName: string): Promise<PersonWorksResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `List 5 other significant movies, events, or projects that "${personName}" is famous for participating in. Do not include generic answers.`,
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
                  entity: { type: Type.STRING, description: "Name of the movie/event/project" },
                  type: { type: Type.STRING, description: "Type (e.g. Movie, Battle)" },
                  description: { type: Type.STRING, description: "Short description" },
                  role: { type: Type.STRING, description: "Role the person played" }
                },
                required: ["entity", "type", "description", "role"]
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return { works: [] };
    return JSON.parse(text) as PersonWorksResponse;
  } catch (error) {
    console.error("Gemini API Error (Person Works):", error);
    throw error;
  }
};