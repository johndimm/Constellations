import { fetchPersonBioViaSearch } from '../services/geminiService';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function test() {
    const name = process.argv[2] || "Rick Moy";
    console.log(`Testing fetchPersonBioViaSearch for "${name}"...`);
    const result = await fetchPersonBioViaSearch(name);
    console.log("\n--- RESULT ---");
    console.log(result);
    console.log("--------------\n");
}

test().catch(console.error);
