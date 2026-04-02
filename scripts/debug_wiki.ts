import { fetchWikipediaSummary } from "../services/wikipediaService";

async function test() {
    const name = "John Dimm";
    console.log(`Testing Wikipedia summary for: ${name}`);
    const result = await fetchWikipediaSummary(name);
    console.log("RESULT:", JSON.stringify(result, null, 2));
}

test().catch(console.error);
