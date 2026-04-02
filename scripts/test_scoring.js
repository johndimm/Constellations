
const excludePatterns = [
    'flag', 'logo', 'seal', 'emblem', 'map', 'icon', 'folder', 'ambox', 'edit-clear',
    'cartoon', 'caricature', 'drawing', 'sketch', 'illustration', 'scientist', 'person', 'outline',
    'pen', 'writing', 'stationery', 'ballpoint', 'refill', 'ink', 'graffiti', 'scribble',
    'building', 'house', 'facade', 'monument', 'statue', 'sculpture', 'medallion', 'coin',
    'crystal', 'clear', 'kedit', 'oojs', 'ui-icon', 'progressive', 'symbol', 'template'
];

function scoreResult(r, index, baseQuery, context) {
    const title = r.title.toLowerCase();
    const snippet = (r.snippet || '').toLowerCase();
    let s = (index === 0) ? 200 : 0;

    const normalizedBase = baseQuery.toLowerCase();
    const queryWantsList = normalizedBase.startsWith("list of ") || normalizedBase.includes("awards") || normalizedBase.includes("nominations") || normalizedBase.includes("filmography") || normalizedBase.includes("discography");
    const isListPage = title.startsWith("list of ") || title.includes(" awards and nominations") || title.includes(" filmography") || title.includes(" discography");
    if (isListPage && !queryWantsList) {
        s -= 2500;
    }

    const cleanTitle = title.replace(/^(the|a|an)\s+/i, '');
    const cleanNormalized = normalizedBase.replace(/^(the|a|an)\s+/i, '');

    if (cleanTitle === cleanNormalized) {
        s += 1000;
    } else if (cleanTitle.startsWith(cleanNormalized + " (")) {
        s += 800;
    }

    if (context) {
        const words = context.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        words.forEach(word => {
            if (title.includes(word)) s += 100;
            if (snippet.includes(word)) s += 50;
        });
    }

    const isMediaTitle = (title) => /\b(film|tv series|miniseries|series|movie|documentary|episode)\b/i.test(title);
    const suffixes = ["(TV series)", "(film)", "(miniseries)", "(series)", "(movie)", "(documentary)", "(episode)"];
    const isMedia = suffixes.some(suf => title.includes(suf.toLowerCase())) || isMediaTitle(title);
    if (isMedia) {
        s -= 400;
    }

    const sportsTerms = ['football', 'soccer', 'rugby', 'cricket', 'goalkeeper', 'striker', 'club', 'fc', 'afc', 'baseball', 'mlb', 'pcl', 'outfield', 'pitcher'];
    sportsTerms.forEach(t => {
        const regex = new RegExp(`\\b${t}\\b`, 'i');
        if (regex.test(title) || regex.test(snippet)) s -= 400;
    });

    if (/born\s\d{4}/.test(snippet)) s += 80;

    const infraTerms = ['airport', 'station', 'stadium', 'university', 'bridge', 'plaza', 'square', 'park', 'boulevard', 'avenue', 'road', 'highway', 'complex', 'tower'];
    infraTerms.forEach(t => {
        if (title.includes(t)) s -= 2000;
    });

    return s;
}

async function testScoring(query, context) {
    const searchQuery = context ? `${query} ${context}` : query;
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=20&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const results = searchData.query.search;

    console.log(`Scoring results for "${query}" with context "${context}":`);
    const scored = results.map((r, idx) => ({
        title: r.title,
        score: scoreResult(r, idx, query, context),
        snippet: r.snippet
    })).sort((a, b) => b.score - a.score);

    const foundMowatt = scored.filter(s => s.title.toLowerCase().includes("mowatt") || s.snippet.toLowerCase().includes("mowatt"));
    if (foundMowatt.length > 0) {
        console.log("!!! FOUND MOWATT !!!");
        console.log(JSON.stringify(foundMowatt, null, 2));
    } else {
        // console.log("No Mowatt found in top 20");
    }

    console.log(JSON.stringify(scored.slice(0, 5), null, 2));
}

async function testAllDomains(query) {
    const domains = [
        "Mathematics", "Literature", "Actors / Movies / TV", "Popular Music",
        "Classical Music", "History", "Science", "Technology", "Art", "Philosophy"
    ];
    for (const domain of domains) {
        await testScoring(query, domain);
        console.log("------------------------------------------");
    }
}

if (process.argv[2] === "--all") {
    testAllDomains(process.argv[3] || "Rick Moy");
} else {
    const query = process.argv[2] || "Rick Moy";
    const context = process.argv[3] || "";
    testScoring(query, context);
}
