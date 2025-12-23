
export const fetchWikipediaImage = async (query: string, context?: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const excludePatterns = [
    'flag', 'logo', 'seal', 'emblem', 'map', 'icon', 'folder', 'ambox', 'edit-clear', 
    'cartoon', 'caricature', 'drawing', 'sketch', 'illustration', 'scientist', 'person', 'outline',
    'pen', 'writing', 'stationery', 'ballpoint', 'refill', 'ink', 'graffiti', 'scribble',
    'building', 'house', 'facade', 'monument', 'statue', 'sculpture', 'medallion', 'coin',
    'crystal', 'clear', 'kedit', 'oojs', 'ui-icon', 'progressive', 'symbol', 'template'
  ];

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
      // 1. Get page info, thumbnail, and all images in one go
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|pageprops|images&titles=${encodeURIComponent(title)}&pithumbsize=500&imlimit=50&redirects=1&origin=*`;
      const res = await fetch(url, { signal });
      const data = await res.json();
      
      const pages = data.query?.pages;
      if (!pages) return null;
      
      const page = Object.values(pages)[0] as any;
      if (page?.pageprops && page.pageprops.disambiguation !== undefined) return null;

      const candidates: { title: string; score: number; url?: string }[] = [];

      // Add official thumbnail as a candidate
      if (page?.thumbnail?.source) {
        const src = page.thumbnail.source.toLowerCase();
        const filename = src.split('/').pop() || '';
        if (!excludePatterns.some(p => filename.includes(p)) && !filename.includes('.svg')) {
          candidates.push({ 
            title: page.pageimage || filename, 
            score: 100, // Bonus for being the official thumbnail
            url: page.thumbnail.source 
          });
        }
      }

      // Add other images on the page
      if (page?.images) {
        page.images.forEach((img: any) => {
          if (candidates.some(c => c.title === img.title)) return;
          candidates.push({ title: img.title, score: 0 });
        });
      }

      if (candidates.length === 0) return null;

      const cleanQuery = query.replace(/[()]/g, ' ').toLowerCase();
      const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 1);

      const scoredCandidates = candidates.map(c => {
        const t = c.title.toLowerCase();
        let s = c.score;

        if (excludePatterns.some(p => t.includes(p))) return { ...c, score: -1000 };

        if (t.includes('poster') || t.includes('cover')) s += 300;
        if (t.includes('portrait') || t.includes('photo') || t.includes('face') || t.includes('headshot')) s += 200;
        if (t.includes('crop') || t.includes('head')) s += 150;
        if (t.includes('film') || t.includes('movie') || t.includes('tv') || t.includes('series')) s += 80;
        
        // Reward solo portraits, penalize group shots
        if (t.includes('with') || t.includes(' and ') || t.includes(' family') || t.includes(' group')) s -= 250;
        
        // Bonus for matching the query words exactly in the filename
        const matches = queryWords.filter(w => t.includes(w)).length;
        s += (matches / Math.max(1, queryWords.length)) * 400;
        
        // Penalty for non-JPEG/PNG (like SVG or WebM)
        if (t.includes('.svg') || t.includes('.webm') || t.includes('.gif')) s -= 300;
        if (t.includes('.jpg') || t.includes('.jpeg')) s += 100; // Increased bonus for JPEG
        if (t.includes('.png')) s -= 50; // Penalize PNGs for people (often low-res video stills)
        
        // Prefer solo filenames
        const wordCount = t.split(/[^a-z]/).filter(w => w.length > 2).length;
        s -= (wordCount * 15); // Stronger penalty for long, descriptive filenames

        return { ...c, score: s };
      }).sort((a, b) => b.score - a.score);

      const best = scoredCandidates[0];
      if (!best || best.score < -100) return null;

      if (best.url) return best.url;
      return await fetchImageInfo(best.title, signal);

    } catch (e) {
      console.error(`Error in fetchPageImage for ${title}:`, e);
    }
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
    const searchQuery = context ? `${query} ${context}` : query;

    // Attempt 1: Media-Aware Search + Direct Lookup
    console.log(`🔍 [ImageSearch] Attempt 1 (Media-Aware): "${searchQuery}"`);
    const initialSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=5&origin=*`;
    const initialSearchRes = await fetch(initialSearchUrl, { signal: controller.signal });
    const initialSearchData = await initialSearchRes.json();
    
    let bestTitle = query;
    if (initialSearchData.query?.search?.length) {
      const results = initialSearchData.query.search;
      const suffixes = ["(TV series)", "(film)", "(miniseries)", "(series)", "(book)", "(TV program)"];
      const mediaResult = results.find((r: any) => 
        suffixes.some(s => r.title.toLowerCase().includes(s.toLowerCase()))
      );
      bestTitle = mediaResult ? mediaResult.title : results[0].title;
    }

    const directImg = await fetchPageImage(bestTitle, controller.signal);
    if (directImg) return directImg;

    // Attempt 2: Base Title + Suffixes
    const suffixes = [" (TV series)", " (film)", " (series)", " (book)", " (miniseries)", " (TV program)"];
    for (const suffix of suffixes) {
      const titleToTry = baseTitle + suffix;
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
        if (t.includes('portrait') || t.includes('photo') || t.includes('face') || t.includes('headshot')) s += 200;
        if (t.includes('poster') || t.includes('cover')) s += 300;
        if (t.includes('crop') || t.includes('head')) s += 150;
        if (t.includes('film') || t.includes('movie') || t.includes('tv') || t.includes('series')) s += 80;
        
        if (t.includes('with') || t.includes(' and ') || t.includes(' family') || t.includes(' group')) s -= 250;
        
        const matches = baseWords.filter(w => t.includes(w));
        if (matches.length < Math.min(2, baseWords.length)) return { res, score: -500 };
        s += (matches.length / baseWords.length) * 500;
        
        if (t.includes('.jpg') || t.includes('.jpeg')) s += 100;
        if (t.includes('.png')) s -= 50;
        if (t.includes('.svg') || t.includes('.webm') || t.includes('.gif')) s -= 300;
        
        const wordCount = t.split(/[^a-z]/).filter(w => w.length > 2).length;
        s -= (wordCount * 15);
        
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

export const fetchWikipediaSummary = async (query: string, context?: string): Promise<string | null> => {
  try {
    console.log(`📡 [Wiki] Fetching summary for "${query}"${context ? ` with context "${context}"` : ''}`);
    
    const cleanQuery = query.replace(/\s*\(.*\)\s*/g, '').trim();
    const searchQuery = context ? `${cleanQuery} ${context}` : query;
    const avoidMedia = /\b(project|program|programme|operation|war|battle|campaign|treaty|scandal)\b/i.test(cleanQuery);
    const isMediaTitle = (title: string) => /\b(film|tv series|miniseries|series|movie|documentary|episode)\b/i.test(title);

    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    
    let bestTitle = query;
    if (searchData.query?.search?.length) {
      const results = searchData.query.search;
      const suffixes = ["(TV series)", "(film)", "(miniseries)", "(series)", "(book)", "(TV program)"];
      const mediaResult = results.find((r: any) =>
        suffixes.some(s => r.title.toLowerCase().includes(s.toLowerCase()))
      );

      if (avoidMedia) {
        const nonMedia = results.find((r: any) => !isMediaTitle(r.title));
        if (nonMedia) {
          bestTitle = nonMedia.title;
          console.log(`✅ [Wiki] Non-media match preferred: "${bestTitle}"`);
        } else {
          bestTitle = results[0].title;
          console.log(`✅ [Wiki] No non-media match, using top result: "${bestTitle}"`);
        }
      } else if (mediaResult) {
        bestTitle = mediaResult.title;
        console.log(`✅ [Wiki] Media-specific match found: "${bestTitle}"`);
      } else {
        bestTitle = results[0].title;
        console.log(`✅ [Wiki] Best general match found: "${bestTitle}"`);
      }
    }

    const summaryUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro&explaintext&titles=${encodeURIComponent(bestTitle)}&redirects=1&origin=*`;
    const summaryRes = await fetch(summaryUrl);
    const summaryData = await summaryRes.json();
    const pages = summaryData.query?.pages;
    
    if (pages) {
      const page = Object.values(pages)[0] as any;
      if (page && !page.missing && !(page.pageprops && page.pageprops.disambiguation !== undefined)) {
        console.log(`✅ [Wiki] Found summary for "${page.title}" (${page.extract?.length || 0} chars)`);

        // If we wanted a non-media entity but got a film/series, retry with a stronger query
        if (avoidMedia && isMediaTitle(page.title)) {
          const retryQuery = `${cleanQuery} project`;
          console.log(`⚠️ [Wiki] Media page returned for "${cleanQuery}". Retrying with "${retryQuery}".`);
          const retry = await fetchWikipediaSummary(retryQuery, context);
          if (retry) return retry;
        }
        
        const isGeneric = page.title.toLowerCase() === cleanQuery.toLowerCase();
        if (isGeneric && (!page.extract || page.extract.length < 150)) {
             console.log(`⚠️ [Wiki] Summary for "${page.title}" is generic/short, searching for media-specific versions.`);
             if (!avoidMedia) {
                 const mediaSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(cleanQuery + " film")}&srlimit=1&origin=*`;
                 const mediaSearchRes = await fetch(mediaSearchUrl);
                 const mediaSearchData = await mediaSearchRes.json();
                 if (mediaSearchData.query?.search?.[0]) {
                     return await fetchWikipediaSummary(mediaSearchData.query.search[0].title);
                 }
             }
        }
        
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
