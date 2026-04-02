
import { fetchConnections, fetchPersonWorks, classifyEntity } from '../services/geminiService';
import { fetchWikipediaSummary } from '../services/wikipediaService';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function testGeminiConfusion(term, context) {
    console.log(`Testing Gemini expansion for: "${term}" with context: "${context}"`);

    try {
        const wiki = await fetchWikipediaSummary(term, context);
        console.log("\nWikipedia result:");
        console.log(JSON.stringify(wiki, null, 2));

        const classification = await classifyEntity(term, wiki.extract || undefined);
        console.log("\nClassification:");
        console.log(JSON.stringify(classification, null, 2));

        let data;
        if (classification.isAtomic) {
            data = await fetchPersonWorks(term, [], wiki.extract || undefined, wiki.pageid?.toString(), classification.type, undefined, wiki.mentioningPageTitles);
        } else {
            data = await fetchConnections(term, context, [], wiki.extract || undefined, wiki.pageid?.toString(), undefined, classification.type, wiki.mentioningPageTitles);
        }

        console.log("\nGemini Expansion Data:");
        console.log(JSON.stringify(data, null, 2));

    } catch (err) {
        console.error("Test failed:", err);
    }
}

const context = "Actors / Movies / TV";
testGeminiConfusion("Rick Moy", context);
