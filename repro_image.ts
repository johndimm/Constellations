
import dotenv from "dotenv";
import path from "path";

const __dirname = path.resolve();
dotenv.config({ path: path.join(__dirname, ".env.local") });

// --- Mocking parts of server.ts logic for testing ---

const fetchImageInfo = async (fileTitle: string): Promise<string | null> => {
    const apis = ['https://en.wikipedia.org/w/api.php', 'https://commons.wikimedia.org/w/api.php'];
    for (const api of apis) {
        try {
            const url = `${api}?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=800&origin=*`;
            const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
            if (!resp.ok) continue;
            const data: any = await resp.json();
            const pagesInfo = data?.query?.pages;
            const imgPage = pagesInfo ? (Object.values(pagesInfo)[0] as any) : null;
            const info = imgPage?.imageinfo?.[0];
            if (info?.thumburl || info?.url) return info.thumburl || info.url;
        } catch { }
    }
    return null;
};

const fetchWikipediaPageImage = async (trimmedTitle: string): Promise<string | null> => {
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(trimmedTitle)}&pithumbsize=800&redirects=1&origin=*`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Constellations/1.0' } });
        if (!resp.ok) return null;
        const data: any = await resp.json();
        const pages = data?.query?.pages;
        const page = pages ? (Object.values(pages)[0] as any) : null;
        return page?.thumbnail?.source || null;
    } catch {
        return null;
    }
};

async function test() {
    const title = "Truman Capote";
    console.log(`Testing image resolution for: "${title}"`);

    const fromPageImage = await fetchWikipediaPageImage(title);
    console.log(`fromPageImage: ${fromPageImage}`);

    if (!fromPageImage) {
        console.log("Page image failed.");
    }
}

test();
