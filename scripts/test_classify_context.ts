
import { classifyStartPair } from '../services/geminiService';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function test() {
    const term = "Rick Moy";
    const context = "Actors / Movies / TV";
    console.log(`Testing classifyStartPair for "${term}" with context "${context}"`);
    const result = await classifyStartPair(term, context);
    console.log(JSON.stringify(result, null, 2));
}

test();
