
async function testWiki(query, context) {
    const searchQuery = context ? `${query} ${context}` : query;
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    console.log("Search Results for:", searchQuery);
    console.log(JSON.stringify(searchData, null, 2));

    const directUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro&explaintext&titles=${encodeURIComponent(query)}&redirects=1&origin=*`;
    const directRes = await fetch(directUrl);
    const directData = await directRes.json();
    console.log("\nDirect Lookup Results for:", query);
    console.log(JSON.stringify(directData, null, 2));
}

const query = process.argv[2] || "Rick Moy";
const context = process.argv[3];
testWiki(query, context);
