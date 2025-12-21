
export const fetchWikipediaImage = async (query: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const fetchImageInfo = async (fileTitle: string, signal: AbortSignal): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=500&origin=*`;
      const res = await fetch(url, { signal });
      const data = await res.json();
      const pages = data.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0] as any;
        return page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url || null;
      }
    } catch (e) {}
    return null;
  };

  const fetchPageImage = async (title: string, signal: AbortSignal): Promise<string | null> => {
    try {
      const excludePatterns = ['flag', 'logo', 'seal', 'emblem', 'map', 'icon', 'folder', 'ambox', 'edit-clear', 'cartoon', 'caricature', 'drawing', 'sketch', 'illustration', 'scientist', 'person', 'outline'];

      // 1. Try pageimages first (the official "thumbnail" for a page, usually the poster/portrait)
      // Also check pageprops to see if it's a disambiguation page
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|pageprops&titles=${encodeURIComponent(title)}&pithumbsize=500&origin=*`;
      const res = await fetch(url, { signal });
      const data = await res.json();
      const pages = data.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0] as any;
        
        // Skip disambiguation pages - we want the specific movie/person page
        if (page?.pageprops && page.pageprops.disambiguation !== undefined) {
          console.log(`[ImageSearch] Skipping disambiguation page: ${title}`);
          return null;
        }

        if (page?.thumbnail?.source) {
          const src = page.thumbnail.source.toLowerCase();
          const filename = src.split('/').pop() || '';
          
          // Check if the main thumbnail is a generic icon
          const isGeneric = excludePatterns.some(p => filename.includes(p)) || filename.includes('.svg');
          if (!isGeneric) return page.thumbnail.source;
          console.log(`[ImageSearch] Skipping generic main thumbnail: ${src}`);
        }
      }

      // 2. Fallback: list all images on the page and pick the best one
      const listUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&titles=${encodeURIComponent(title)}&imlimit=50&origin=*`;
      const listRes = await fetch(listUrl, { signal });
      const listData = await listRes.json();
      const listPages = listData.query?.pages;
      if (listPages) {
        const page = Object.values(listPages)[0] as any;
        if (page?.images) {
          const queryWords = query.toLowerCase().split(' ');
          
          const sortedImages = [...page.images].sort((a: any, b: any) => {
            const ta = a.title.toLowerCase();
            const tb = b.title.toLowerCase();
            
            const getScore = (t: string) => {
              if (excludePatterns.some(p => t.includes(p))) return -100;
              let s = 0;
              if (t.includes('poster') || t.includes('cover')) s += 50;
              if (t.includes('portrait') || t.includes('photo')) s += 40;
              if (queryWords.every(w => t.includes(w))) s += 30;
              else if (queryWords.some(w => t.includes(w))) s += 10;
              if (t.includes('.jpg') || t.includes('.jpeg')) s += 5;
              if (t.includes('.svg') || t.includes('.png')) s -= 10;
              return s;
            };
            
            return getScore(tb) - getScore(ta);
          });

          const bestImage = sortedImages[0];
          if (bestImage && !excludePatterns.some(p => bestImage.title.toLowerCase().includes(p))) {
            return await fetchImageInfo(bestImage.title, signal);
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
    // 1. Attempt: Direct Wikipedia Page lookup (Exact match)
    console.log(`[ImageSearch] Attempt 1: Direct page lookup for "${query}"`);
    const directImg = await fetchPageImage(query, controller.signal);
    if (directImg) {
      console.log(`[ImageSearch] Found image via Attempt 1 (Direct Page): ${directImg}`);
      clearTimeout(timeoutId);
      return directImg;
    }

    // 2. Attempt: Wikipedia Search with " (film)" or " (book)" disambiguation
    // Move this higher so "Scarface" finds "Scarface (1983 film)" before random Commons files
    if (!query.includes('(')) {
      for (const suffix of [" (film)", " (book)"]) {
        console.log(`[ImageSearch] Attempt 2: Disambiguation lookup for "${query + suffix}"`);
        const disambigImg = await fetchPageImage(query + suffix, controller.signal);
        if (disambigImg) {
          console.log(`[ImageSearch] Found image via Attempt 2 (Disambiguation): ${disambigImg}`);
          clearTimeout(timeoutId);
          return disambigImg;
        }
      }
    }

    // 3. Attempt: Direct Wikimedia Commons Search (File Namespace)
    console.log(`[ImageSearch] Attempt 3: Commons file search for "${query}"`);
    const commonsSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=10&origin=*`;
    const commonsRes = await fetch(commonsSearchUrl, { signal: controller.signal });
    const commonsData = await commonsRes.json();
    if (commonsData.query?.search?.length) {
      const exclude = ['flag', 'logo', 'seal', 'emblem', 'map', 'icon', 'cartoon', 'caricature', 'drawing', 'sketch', 'illustration', 'scientist', 'person', 'outline'];
      const queryWords = query.toLowerCase().split(' ');

      const sortedResults = [...commonsData.query.search].sort((a: any, b: any) => {
        const ta = a.title.toLowerCase();
        const tb = b.title.toLowerCase();
        
        const getScore = (t: string) => {
          if (exclude.some(p => t.includes(p))) return -100;
          let s = 0;
          if (t.includes('portrait') || t.includes('photo')) s += 50;
          if (queryWords.every(w => t.includes(w))) s += 30;
          else if (queryWords.some(w => t.includes(w))) s += 10;
          if (t.includes('.jpg') || t.includes('.jpeg')) s += 5;
          if (t.includes('.svg') || t.includes('.png')) s -= 10;
          return s;
        };
        
        return getScore(tb) - getScore(ta);
      });

      console.log(`[ImageSearch] Attempt 3 found ${sortedResults.length} candidates.`);

      for (const result of sortedResults) {
        if (!exclude.some(p => result.title.toLowerCase().includes(p))) {
          const img = await fetchImageInfo(result.title, controller.signal);
          if (img) {
            console.log(`[ImageSearch] Found image via Attempt 3 (Commons Search): ${img} from file ${result.title}`);
            clearTimeout(timeoutId);
            return img;
          }
        }
      }
    }

    // 4. Attempt: General Wikipedia Article Search
    console.log(`[ImageSearch] Attempt 4: General article search for "${query}"`);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: controller.signal });
    const searchData = await searchRes.json();
    if (searchData.query?.search?.length) {
      for (const result of searchData.query.search) {
        const img = await fetchPageImage(result.title, controller.signal);
        if (img) {
          console.log(`[ImageSearch] Found image via Attempt 4 (General Search): ${img} from page ${result.title}`);
          clearTimeout(timeoutId);
          return img;
        }
      }
    }

    // 5. Last Resort: Google Books
    console.log(`[ImageSearch] Attempt 5: Google Books fallback for "${query}"`);
    const googleImg = await fetchGoogleBooksImage(query, controller.signal);
    if (googleImg) {
      console.log(`[ImageSearch] Found image via Attempt 5 (Google Books): ${googleImg}`);
      clearTimeout(timeoutId);
      return googleImg;
    }

  } catch (e) {
    // Silently fail
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
};
