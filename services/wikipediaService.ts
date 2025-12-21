
export const fetchWikipediaImage = async (query: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const excludePatterns = ['flag', 'logo', 'seal', 'emblem', 'map', 'icon', 'folder', 'ambox', 'edit-clear', 'cartoon', 'caricature', 'drawing', 'sketch', 'illustration', 'scientist', 'person', 'outline'];

  // Helper to fetch image info from either Wikipedia or Commons
  const fetchImageInfo = async (fileTitle: string, signal: AbortSignal): Promise<string | null> => {
    const apis = [
      `https://en.wikipedia.org/w/api.php`,
      `https://commons.wikimedia.org/w/api.php`
    ];

    for (const api of apis) {
      try {
        const url = `${api}?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=500&origin=*`;
        const res = await fetch(url, { signal });
        const data = await res.json();
        const pages = data.query?.pages;
        if (pages) {
          const page = Object.values(pages)[0] as any;
          if (page && !page.missing) {
            const info = page.imageinfo?.[0];
            if (info?.thumburl || info?.url) return info.thumburl || info.url;
          }
        }
      } catch (e) {}
    }
    return null;
  };

  const fetchPageImage = async (title: string, signal: AbortSignal): Promise<string | null> => {
    try {
      // 1. Try pageimages first (official thumbnail)
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|pageprops&titles=${encodeURIComponent(title)}&pithumbsize=500&redirects=1&origin=*`;
      const res = await fetch(url, { signal });
      const data = await res.json();
      
      // Handle redirects in the response
      let resolvedTitle = title;
      if (data.query?.redirects && data.query.redirects.length > 0) {
        resolvedTitle = data.query.redirects[0].to;
      }

      const pages = data.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0] as any;
        if (page?.pageprops && page.pageprops.disambiguation !== undefined) return null;
        if (page?.thumbnail?.source) {
          const src = page.thumbnail.source.toLowerCase();
          const filename = src.split('/').pop() || '';
          if (!excludePatterns.some(p => filename.includes(p)) && !filename.includes('.svg')) {
            return page.thumbnail.source;
          }
        }
      }

      // 2. Fallback: list all images on the page
      const listUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&titles=${encodeURIComponent(resolvedTitle)}&imlimit=50&origin=*`;
      const listRes = await fetch(listUrl, { signal });
      const listData = await listRes.json();
      const listPages = listData.query?.pages;
      if (listPages) {
        const page = Object.values(listPages)[0] as any;
        if (page?.images) {
          const cleanQuery = query.replace(/[()]/g, ' ').toLowerCase();
          const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 1);
          
          const sortedImages = [...page.images].sort((a: any, b: any) => {
            const getScore = (img: any) => {
              const t = img.title.toLowerCase();
              if (excludePatterns.some(p => t.includes(p))) return -1000;
              let s = 0;
              if (t.includes('poster') || t.includes('cover')) s += 100;
              if (t.includes('portrait') || t.includes('photo')) s += 80;
              const matches = queryWords.filter(w => t.includes(w)).length;
              s += (matches / Math.max(1, queryWords.length)) * 200;
              if (t.includes('.jpg') || t.includes('.jpeg')) s += 20;
              return s;
            };
            return getScore(b) - getScore(a);
          });

          for (const img of sortedImages.slice(0, 5)) {
            const url = await fetchImageInfo(img.title, signal);
            if (url) return url;
          }
        }
      }
    } catch (e) {}
    return null;
  };

  const fetchGoogleBooksImage = async (q: string, signal: AbortSignal): Promise<string | null> => {
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = await res.json();
        const img = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
        return img ? img.replace('http://', 'https://') : null;
      }
    } catch (e) {}
    return null;
  };

  try {
    const baseTitle = query.includes('(') ? query.split('(')[0].trim() : query;

    // Attempt 1: Direct Lookup
    console.log(`🔍 [ImageSearch] Attempt 1 (Direct): "${query}"`);
    const directImg = await fetchPageImage(query, controller.signal);
    if (directImg) return directImg;

    // Attempt 2: Base Title + Suffixes
    const suffixes = [" (TV series)", " (film)", " (series)", " (book)", " (miniseries)", " (TV program)"];
    for (const suffix of suffixes) {
      const titleToTry = baseTitle + suffix;
      // Skip if exactly the same as initial query
      if (titleToTry === query) continue;
      
      console.log(`🔍 [ImageSearch] Attempt 2 (Suffix): "${titleToTry}"`);
      const img = await fetchPageImage(titleToTry, controller.signal);
      if (img) return img;
    }

    // Attempt 3: Wikimedia Commons Search (Global)
    console.log(`🔍 [ImageSearch] Attempt 3 (Commons): "${baseTitle}"`);
    const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(baseTitle)}&srnamespace=6&srlimit=10&origin=*`;
    const commonsRes = await fetch(commonsUrl, { signal: controller.signal });
    const commonsData = await commonsRes.json();
    if (commonsData.query?.search?.length) {
      const baseWords = baseTitle.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const scoredResults = commonsData.query.search.map((res: any) => {
        const t = res.title.toLowerCase();
        if (excludePatterns.some(p => t.includes(p))) return { res, score: -1000 };
        let s = 0;
        if (t.includes('portrait') || t.includes('photo')) s += 100;
        const matches = baseWords.filter(w => t.includes(w));
        if (matches.length < Math.min(2, baseWords.length)) return { res, score: -500 };
        s += (matches.length / baseWords.length) * 500;
        return { res, score: s };
      }).sort((a: any, b: any) => b.score - a.score);

      const best = scoredResults[0];
      if (best && best.score > 0) {
        const img = await fetchImageInfo(best.res.title, controller.signal);
        if (img) return img;
      }
    }

    // Attempt 4: General Wikipedia Search
    console.log(`🔍 [ImageSearch] Attempt 4 (Search): "${baseTitle}"`);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(baseTitle)}&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: controller.signal });
    const searchData = await searchRes.json();
    if (searchData.query?.search?.length) {
      for (const result of searchData.query.search) {
        const img = await fetchPageImage(result.title, controller.signal);
        if (img) return img;
      }
    }

    // Attempt 5: Google Books
    return await fetchGoogleBooksImage(query, controller.signal);

  } catch (e) {
    console.error("Image fetch failed:", query, e);
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
};

export const fetchWikipediaSummary = async (query: string): Promise<string | null> => {
  try {
    console.log(`📡 [Wiki] Fetching summary for "${query}"`);
    
    // Clean query: "The Beast in Me (TV Series)" -> "The Beast in Me"
    const cleanQuery = query.replace(/\s*\(.*\)\s*/g, '').trim();

    // 1. Try a search with a higher limit to find the best media-related candidate
    // This handles cases like "The Beast in Me" where the song might be result #1 
    // but the TV series is result #2.
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    
    let bestTitle = query;
    if (searchData.query?.search?.length) {
      const results = searchData.query.search;
      
      // Heuristic: Prefer results with media suffixes
      const suffixes = ["(TV series)", "(film)", "(miniseries)", "(series)", "(book)", "(TV program)"];
      const mediaResult = results.find((r: any) => 
        suffixes.some(s => r.title.toLowerCase().includes(s.toLowerCase()))
      );

      if (mediaResult) {
        bestTitle = mediaResult.title;
        console.log(`✅ [Wiki] Media-specific match found: "${bestTitle}"`);
      } else {
        bestTitle = results[0].title;
        console.log(`✅ [Wiki] Best general match found: "${bestTitle}"`);
      }
    }

    // 2. Fetch the summary for the best title
    const summaryUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro&explaintext&titles=${encodeURIComponent(bestTitle)}&redirects=1&origin=*`;
    const summaryRes = await fetch(summaryUrl);
    const summaryData = await summaryRes.json();
    const pages = summaryData.query?.pages;
    
    if (pages) {
      const page = Object.values(pages)[0] as any;
      if (page && !page.missing && !(page.pageprops && page.pageprops.disambiguation !== undefined)) {
        console.log(`✅ [Wiki] Found summary for "${page.title}" (${page.extract?.length || 0} chars)`);
        // If the summary is too short, try searching with the clean query
        if ((!page.extract || page.extract.length < 50) && cleanQuery !== query) {
            console.log(`⚠️ [Wiki] Summary too short, trying search with clean query: "${cleanQuery}"`);
            return await fetchWikipediaSummary(cleanQuery);
        }
        return page.extract || null;
      }
    }
    
    console.log(`❌ [Wiki] No summary found for "${bestTitle}"`);
  } catch (e) {
    console.error(`❌ [Wiki] Error fetching summary for "${query}":`, e);
  }
  return null;
};
