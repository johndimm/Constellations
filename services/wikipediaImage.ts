export async function fetchWikipediaImage(title: string): Promise<string | null> {
    if (!title) return null;
    try {
        // 1. Try exact title with redirects
        let endpoint = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=300&redirects&origin=*`;
        let res = await fetch(endpoint);
        let data = await res.json();
        let pages = data?.query?.pages;

        const getFirstPageImage = (pagesObj: any) => {
            if (!pagesObj) return null;
            const keys = Object.keys(pagesObj);
            if (!keys.length) return null;
            // Iterate to find first real page (not -1 unless that's all there is)
            for (const key of keys) {
                if (key !== '-1' && pagesObj[key]?.thumbnail?.source) {
                    return pagesObj[key].thumbnail.source;
                }
            }
            return null;
        };

        let imgUrl = getFirstPageImage(pages);
        if (imgUrl) return imgUrl;

        // 2. Fallback: Search for the title if direct lookup failed
        // "Guggenheim Museum" -> "Solomon R. Guggenheim Museum"
        console.log(`Wiki image direct lookup failed for "${title}", trying search...`);
        endpoint = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(title)}&gsrlimit=1&prop=pageimages&format=json&pithumbsize=300&origin=*`;
        res = await fetch(endpoint);
        data = await res.json();
        pages = data?.query?.pages;

        return getFirstPageImage(pages);

    } catch (e) {
        console.error("Wiki image fetch failed", e);
        return null;
    }
}
