import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.VITE_API_KEY || process.env.API_KEY || process.env.REACT_APP_API_KEY;

if (!apiKey) {
  console.error("No API key found in environment");
  process.exit(1);
}

const genAI = new GoogleGenAI(apiKey);

async function listModels() {
  try {
    const models = await genAI.listModels();
    console.log(JSON.stringify(models, null, 2));
  } catch (e) {
    console.error("Error listing models:", e.message);
  }
}

listModels();
