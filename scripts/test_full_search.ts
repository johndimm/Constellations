
import { classifyStartPair } from '../services/geminiService';
import { fetchWikipediaSummary } from '../services/wikipediaService';

async function testFullSearch(term) {
    console.log(`Testing search for: "${term}"`);

    try {
        const classification = await classifyStartPair(term);
        console.log("\nClassification results:");
        console.log(JSON.stringify(classification, null, 2));

        const wiki = await fetchWikipediaSummary(term);
        console.log("\nWikipedia Summary results:");
        console.log(JSON.stringify(wiki, null, 2));

    } catch (err) {
        console.error("Full search test failed:", err);
    }
}

testFullSearch("Rick Moy");
