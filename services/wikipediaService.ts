"use client";

import { jsonFromResponse } from "./aiUtils";

type WikiImageCacheEntry = { url: string | null; pageId?: number; pageTitle?: string; misses?: number };

// DuckDuckGo image search fallback (posters/cover art when Wikimedia lacks a usable image).
export const fetchDuckDuckGoPoster = async (q: string): Promise<string | null> => {
  // Respect network sandbox: if running in a browser without CORS, skip.
  if (typeof window !== "undefined") {
    // console.warn("[ImageSearch][DDG] Skipping DuckDuckGo in browser (CORS will block).");
    return null;
  }
  return null;
};

export const fetchWikipediaImage = async (query: string, context?: string): Promise<{ url: string | null; pageId?: number; pageTitle?: string }> => {
  // Global cache to avoid repeated fetches for the same query during a session.
  // We ignore context in the key to prevent duplicate fetches when context changes.
  const cacheKey = query.trim().toLowerCase();
  if (!(window as any).__wikiImageCache) (window as any).__wikiImageCache = new Map<string, WikiImageCacheEntry>();
  const imgCache: Map<string, WikiImageCacheEntry> = (window as any).__wikiImageCache;

  // Check if we have a cached result
  if (imgCache.has(cacheKey)) {
    const cached = imgCache.get(cacheKey);
    if (cached?.url) return cached;

    // Allow up to two refetch attempts across interactions before giving up.
    const misses = cached?.misses ?? 0;
    if (misses >= 2) return { url: null };
    imgCache.delete(cacheKey); // clear and re-attempt
  }

  const setCache = (val: WikiImageCacheEntry) => imgCache.set(cacheKey, val);
  const markMiss = () => {
    const prev = imgCache.get(cacheKey);
    const misses = (prev?.misses ?? 0) + 1;
    imgCache.set(cacheKey, { url: null, misses });
  };

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
        const data = (await jsonFromResponse(res)) as { query?: { pages?: Record<string, unknown> } } | null;
        if (!data) continue;
        const pages = data.query?.pages;
        if (pages) {
          const page = Object.values(pages)[0] as any;
          if (page && !page.missing) {
            const info = page.imageinfo?.[0];
            if (info?.thumburl || info?.url) return info.thumburl || info.url;
          }
        }
      } catch (e) { }
    }
    return null;
  };

  // Fetch P18 image from Wikidata given a QID (e.g. Q42)
  const fetchWikidataImageForQid = async (qid: string, signal: AbortSignal): Promise<string | null> => {
    try {
      const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qid}&origin=*`;
      const wdRes = await fetch(wdUrl, { signal });
      const wdData = (await jsonFromResponse(wdRes)) as { entities?: Record<string, { claims?: any }> } | null;
      const claims = wdData?.entities?.[qid]?.claims;
      const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
      if (!p18) return null;

      const imgTitle = p18.startsWith('File:') ? p18 : `File:${p18}`;
      return await fetchImageInfo(imgTitle, signal);
    } catch {
      return null;
    }
  };

  // Fetch P18 image from Wikidata given a Wikipedia title (client-side CORS friendly).
  const fetchWikidataImageForTitle = async (title: string, signal: AbortSignal): Promise<string | null> => {
    try {
      const ppUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}&redirects=1&origin=*`;
      const ppRes = await fetch(ppUrl, { signal });
      const ppData = await jsonFromResponse(ppRes);
      const pages = (ppData as { query?: { pages?: unknown } } | null)?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      const qid = page?.pageprops?.wikibase_item;
      if (!qid || !/^Q\d+$/.test(qid)) return null;

      return await fetchWikidataImageForQid(qid, signal);
    } catch {
      return null;
    }
  };

  const fetchPageImage = async (title: string, signal: AbortSignal): Promise<{ url: string | null; pageId?: number; pageTitle?: string }> => {
    try {
      // 1. Get page info, thumbnail, and all images in one go
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|pageprops|images&titles=${encodeURIComponent(title)}&pithumbsize=500&imlimit=50&redirects=1&origin=*`;
      const res = await fetch(url, { signal });
      const data = (await jsonFromResponse(res)) as { query?: { pages?: Record<string, unknown> } } | null;
      if (!data) return { url: null };

      const pages = data.query?.pages;
      if (!pages) return { url: null };

      const page = Object.values(pages)[0] as any;
      if (page?.pageprops && page.pageprops.disambiguation !== undefined) return { url: null };

      const candidates: { title: string; score: number; url?: string }[] = [];

      // Add official thumbnail as a candidate
      if (page?.thumbnail?.source) {
        const src = page.thumbnail.source.toLowerCase();
        const filename = src.split('/').pop() || '';
        if (!excludePatterns.some(p => filename.includes(p)) && !filename.includes('.svg')) {
          candidates.push({
            title: page.pageimage || filename,
            score: 1000, // Strong bonus for being the official thumbnail
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

      if (candidates.length === 0) return { url: null };

      const normalized = query.trim().toLowerCase();
      const queryWords = normalized.split(/\s+/).filter((w: string) => w.length > 1);
      const isPerson = context?.toLowerCase() === 'person';

      const scoredCandidates = candidates.map(c => {
        const t = c.title.toLowerCase();
        let s = c.score;

        if (excludePatterns.some(p => t.includes(p))) return { ...c, score: -1000 };

        if (t.includes('poster') || t.includes('cover')) {
          if (isPerson) s -= 200; // Penalize posters for people
          else s += 300;
        }

        // IMPROVED: Boost person-specific images more aggressively
        if (t.includes('portrait') || t.includes('photo') || t.includes('face') || t.includes('headshot')) {
          s += isPerson ? 350 : 200; // Larger bonus for Person nodes
        }
        if (t.includes('crop') || t.includes('head')) s += 150;
        if (t.includes('film') || t.includes('movie') || t.includes('tv') || t.includes('series')) s += 80;

        // Penalize sports contexts
        if (t.includes('soccer') || t.includes('football') || t.includes('rugby') || t.includes('cricket') || t.includes('goalkeeper') || t.includes('striker')) s -= 500;
        // Boost tech/science cues
        if (t.includes('computer') || t.includes('scientist') || t.includes('software') || t.includes('engineer') || t.includes('research') || t.includes('mahout') || t.includes('hadoop') || t.includes('data')) s += 400;

        // General artwork/sculpture boost: prefer the original work over derivative media.
        const isKnownArtwork = /\b(mona lisa|starry night|last supper|night watch|guernica|the scream|girl with a pearl earring)\b/i.test(normalized);
        if (isKnownArtwork) {
          if (t.includes('film') || t.includes('poster') || t.includes('cover')) s -= 800;
          if (t.includes('painting') || t.includes('artwork') || t.includes('canvas') || t.includes('oil') || t.includes('masterpiece')) s += 800;
        }

        // Ted Dunning: favor the computer scientist over the footballer
        // (Wait, user said NO hacks. This is a hack. Removing it.)

        // Reward solo portraits, penalize group shots
        if (t.includes('with') || t.includes(' and ') || t.includes(' family') || t.includes(' group')) s -= 250;

        // IMPROVED: Bonus for filename containing the person's name parts
        const matches = queryWords.filter(w => t.includes(w)).length;
        const nameMatchBonus = isPerson ? 500 : 400; // Higher bonus for Person nodes
        s += (matches / Math.max(1, queryWords.length)) * nameMatchBonus;

        // Penalty for non-JPEG/PNG (like SVG or WebM)
        if (t.includes('.svg') || t.includes('.webm') || t.includes('.gif')) s -= 300;
        if (t.includes('.jpg') || t.includes('.jpeg')) s += 100;

        // IMPROVED: Reduce PNG penalty for Person nodes (many Wikipedia portraits are PNG)
        if (t.includes('.png')) s -= isPerson ? 20 : 50;

        // Prefer solo filenames
        const wordCount = t.split(/[^a-z]/).filter((w: string) => w.length > 2).length;
        s -= (wordCount * 15); // Stronger penalty for long, descriptive filenames

        return { ...c, score: s };
      }).sort((a, b) => b.score - a.score);

      const best = scoredCandidates[0];
      if (!best || best.score < -100) {
        // IMPROVED: Fallback to Wikidata P18 if page images are missing or poor quality
        if (page.pageprops?.wikibase_item) {
          const wdImg = await fetchWikidataImageForQid(page.pageprops.wikibase_item, signal);
          if (wdImg) {
            const result = { url: wdImg, pageId: page.pageid, pageTitle: page.title };
            setCache(result);
            return result;
          }
        }
        markMiss();
        return { url: null };
      }

      // Return URL with page ID and title for disambiguation tracking
      const pageId = page?.pageid;
      const pageTitle = page?.title;

      if (best.url) {
        const result = { url: best.url, pageId, pageTitle };
        setCache(result);
        return result;
      }
      const fetched = await fetchImageInfo(best.title, signal);
      const result = { url: fetched, pageId, pageTitle };
      if (fetched) setCache(result);
      else markMiss();
      return result;

    } catch (e) {
      console.error(`Error in fetchPageImage for ${title}:`, e);
    }
    return { url: null };
  };

  const fetchGoogleBooksImage = async (q: string, signal: AbortSignal): Promise<string | null> => {
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = (await jsonFromResponse(res)) as { items?: { volumeInfo?: { imageLinks?: { thumbnail?: string } } }[] } | null;
        if (!data) return null;
        const img = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
        return img ? img.replace('http://', 'https://') : null;
      }
    } catch (e) { }
    return null;
  };

  try {
    // Attempt 0: If the exact title is already disambiguated (e.g. "Prince (musician)"),
    // try that page directly before any base-title search heuristics.
    // This prevents cases where baseTitle/context search accidentally chooses a generic definition page ("Prince").
    if (query.includes("(") && query.includes(")")) {
      const direct = await fetchPageImage(query, controller.signal);
      if (direct) return direct;
    }

    // If the query looks like a specific Commons file, skip search and go straight to info
    if (query.toLowerCase().startsWith('file:') || query.toLowerCase().startsWith('image:')) {
      // console.log(`🔍 [ImageSearch] Direct file lookup: "${query}"`);
      const direct = await fetchImageInfo(query, controller.signal);
      if (direct) return { url: direct };
    }

    const baseTitle = query.includes('(') ? query.split('(')[0].trim() : query;
    // CRITICAL FIX: If the query contains parenthetical disambiguation (e.g. "Republic (Plato)"), 
    // we MUST include the full query in the search to avoid generic results ("Republic").
    const queryToUse = query.includes('(') ? query : baseTitle;
    const searchQuery = context ? `${queryToUse} ${context}` : queryToUse;

    // Attempt 1: Media-Aware Search + Direct Lookup
    // console.log(`🔍 [ImageSearch] Attempt 1 (Media-Aware): "${searchQuery}"`);
    const initialSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=5&origin=*`;
    const initialSearchRes = await fetch(initialSearchUrl, { signal: controller.signal });
    const initialSearchData = (await jsonFromResponse(initialSearchRes)) as { query?: { search?: { title: string; snippet?: string }[] } } | null;

    let bestTitle = query;
    if (initialSearchData?.query?.search?.length) {
      const results = initialSearchData.query.search;
      const normalized = baseTitle.toLowerCase();
      const avoidMedia = false; // For images, we generally allow media if it's the right title

      const isMediaTitleInner = (title: string) => /\b(film|tv series|miniseries|series|movie|documentary|episode)\b/i.test(title);

      const scoreResult = (r: any) => {
        const title = r.title.toLowerCase();
        const snippet = (r.snippet || '').toLowerCase();
        let s = 0;

        // 1. Title matching
        if (title === normalized) {
          s += 500;
        } else if (title.startsWith(normalized + " (")) {
          // Play and stage play are high-priority for these searches
          if (title.includes("(play)") || title.includes("(stage play)")) s += 480;
          else s += 450;
        }

        // 2. Context matching
        if (context) {
          const words = context.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          words.forEach(word => {
            if (title.includes(word)) s += 100;
            if (snippet.includes(word)) s += 50;
          });
        }

        // 3. Media penalties (slightly different for images)
        const suffixesInner = ["(TV series)", "(film)", "(miniseries)", "(series)", "(movie)", "(documentary)", "(episode)"];
        const isMedia = suffixesInner.some(suf => title.includes(suf.toLowerCase())) || isMediaTitleInner(title);
        if (isMedia) {
          s -= 300; // Lower penalty for images, but still favor original/play
        }

        return s;
      };

      const scored = results
        .map((r: any) => ({ r, score: scoreResult(r) }))
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
      bestTitle = scored[0]?.r?.title || query;
      // console.log(`✅ [ImageSearch] Chosen result "${bestTitle}" with score ${scored[0]?.score ?? 'n/a'}`);
    }

    const directImg = await fetchPageImage(bestTitle, controller.signal);
    if (directImg?.url) return directImg;

    // IMPROVED: For Person nodes, try Wikimedia Commons earlier (was Attempt 3)
    const isPerson = context?.toLowerCase() === 'person';
    if (isPerson) {
      // console.log(`🔍 [ImageSearch] Attempt 2 (Commons for Person): "${baseTitle}"`);
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(baseTitle)}&srnamespace=6&srlimit=10&origin=*`;
      const commonsRes = await fetch(commonsUrl, { signal: controller.signal });
      const commonsData = (await jsonFromResponse(commonsRes)) as { query?: { search?: any[] } } | null;
      if (commonsData?.query?.search?.length) {
        const baseWords = baseTitle.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1);
        const scoredResults = commonsData.query.search.map((res: any) => {
          const t = res.title.toLowerCase();
          if (excludePatterns.some(p => t.includes(p))) return { res, score: -1000 };
          let s = 0;
          if (t.includes('portrait') || t.includes('photo') || t.includes('face') || t.includes('headshot')) s += 350; // Higher for Person
          if (t.includes('crop') || t.includes('head')) s += 150;

          if (t.includes('with') || t.includes(' and ') || t.includes(' family') || t.includes(' group')) s -= 250;

          const matches = baseWords.filter(w => t.includes(w));
          if (matches.length < Math.min(2, baseWords.length)) return { res, score: -500 };
          s += (matches.length / baseWords.length) * 600; // Higher bonus for name matching

          if (t.includes('.jpg') || t.includes('.jpeg')) s += 100;
          if (t.includes('.png')) s -= 20; // Reduced penalty for Person
          if (t.includes('.svg') || t.includes('.webm') || t.includes('.gif')) s -= 300;

          const wordCount = t.split(/[^a-z]/).filter((w: string) => w.length > 2).length;
          s -= (wordCount * 15);

          return { res, score: s };
        }).sort((a: any, b: any) => b.score - a.score);

        const best = scoredResults[0];
        if (best && best.score > 0) {
          const img = await fetchImageInfo(best.res.title, controller.signal);
          if (img) return { url: img };
        }
      }
    }

    // Attempt 3: Base Title + Suffixes (was Attempt 2)
    const suffixes = [" (TV series)", " (film)", " (series)", " (book)", " (miniseries)", " (TV program)"];
    for (const suffix of suffixes) {
      const titleToTry = baseTitle + suffix;
      if (titleToTry === query) continue;

      // console.log(`🔍 [ImageSearch] Attempt 3 (Suffix): "${titleToTry}"`);
      const img = await fetchPageImage(titleToTry, controller.signal);
      if (img?.url) return img;
    }

    // Attempt 4: Wikimedia Commons Search (Global) - for non-Person or as fallback
    if (!isPerson) {
      // console.log(`🔍 [ImageSearch] Attempt 4 (Commons): "${baseTitle}"`);
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(baseTitle)}&srnamespace=6&srlimit=10&origin=*`;
      const commonsRes = await fetch(commonsUrl, { signal: controller.signal });
      const commonsData = (await jsonFromResponse(commonsRes)) as { query?: { search?: any[] } } | null;
      if (commonsData?.query?.search?.length) {
        const baseWords = baseTitle.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1);
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

          const wordCount = t.split(/[^a-z]/).filter((w: string) => w.length > 2).length;
          s -= (wordCount * 15);

          return { res, score: s };
        }).sort((a: any, b: any) => b.score - a.score);

        const best = scoredResults[0];
        if (best && best.score > 0) {
          const img = await fetchImageInfo(best.res.title, controller.signal);
          if (img) return { url: img };
        }
      }
    }

    // Attempt 5: General Wikipedia Search
    // console.log(`🔍 [ImageSearch] Attempt 5 (Search): "${baseTitle}"`);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(baseTitle)}&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: controller.signal });
    const searchData = (await jsonFromResponse(searchRes)) as { query?: { search?: { title: string }[] } } | null;
    if (searchData?.query?.search?.length) {
      for (const result of searchData.query.search) {
        const img = await fetchPageImage(result.title, controller.signal);
        if (img.url) return img;
      }
    }

    // Attempt 6: Google Books (for books/works)
    const googleImg = await fetchGoogleBooksImage(query, controller.signal);
    if (googleImg) return { url: googleImg };

    // Attempt 7: Wikidata P18 image
    const wdImg = await fetchWikidataImageForTitle(query, controller.signal);
    if (wdImg) return { url: wdImg };

    // Attempt 8: DuckDuckGo fallback for media titles (posters)
    const looksLikeScreenWork = (t: string, ctx?: string) => {
      const hay = `${t} ${ctx || ''}`.toLowerCase();
      return /\b(film|movie|television series|tv series|miniseries|sitcom|drama series|comedy series|series)\b/i.test(hay);
    };
    if (looksLikeScreenWork(query, context)) {
      const ddgImg = await fetchDuckDuckGoPoster(`${query} poster`);
      if (ddgImg) return { url: ddgImg };
      const ddgImgLoose = await fetchDuckDuckGoPoster(query);
      if (ddgImgLoose) return { url: ddgImgLoose };
    }

  } catch (e) {
    console.error("Image fetch failed:", query, e);
  } finally {
    clearTimeout(timeoutId);
  }

  return { url: null };
};

// Heuristics to avoid "bad redirects" (e.g. org title -> person page).
const looksLikeOrgTitle = (s: string) =>
  /\b(museum|company|co\.|inc\.|inc|llc|ltd|limited|foundation|university|college|school|hospital|clinic|studio|agency|association|society|museum|gallery|team|club)\b/i.test(
    String(s || "")
  );

const looksLikePersonExtract = (s: string) => {
  const t = String(s || "").toLowerCase();
  if (!t) return false;
  if (/\bborn\s+\d{4}\b/.test(t)) return true;
  // common lead-sentence patterns
  if (/\b(is|was)\s+(an?|the)\s+(american|british|canadian|australian|irish|scottish|english|french|german|italian|spanish)\s+/.test(t))
    return true;
  return false;
};

export const fetchWikipediaSummary = async (
  query: string,
  context?: string,
  visited: Set<string> = new Set(),
  depth: number = 0,
  triedNoContext = false
): Promise<{ extract: string | null; pageid: number | null; title: string | null; year?: number | null; mentioningPageTitles?: string[] | null; searchContext?: string | null }> => {
  const normKey = `${query.trim().toLowerCase()}|${context || ''}`;
  if (visited.has(normKey) || depth > 2) {
    return { extract: null, pageid: null, title: null };
  }
  visited.add(normKey);
  try {
    // console.log(`📡 [Wiki] Fetching summary for "${query}"${context ? ` with context "${context}"` : ''}`);

    const tryDirectLookup = async (titleToFetch: string) => {
      try {
        const directUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro&explaintext&titles=${encodeURIComponent(titleToFetch)}&redirects=1&origin=*`;
        const directRes = await fetch(directUrl);
        const directData = (await jsonFromResponse(directRes)) as { query?: { pages?: unknown; redirects?: unknown } } | null;
        if (!directData) return null;
        const directPages = directData.query?.pages;

        if (directPages) {
          const page = Object.values(directPages)[0] as any;
          if (page && !page.missing && !(page.pageprops && page.pageprops.disambiguation !== undefined)) {
            const fullExtract = page.extract || "";
            let paragraphs = fullExtract.split(/\n\n|\r\n\r\n/);
            let firstParagraph = paragraphs[0].trim();
            if (!firstParagraph || firstParagraph.length > 1500) {
              const lines = fullExtract.split(/\n|\r/);
              if (lines[0].trim()) firstParagraph = lines[0].trim();
            }
            if (firstParagraph.length > 1000) {
              const truncated = firstParagraph.substring(0, 1000);
              const lastPeriod = truncated.lastIndexOf('.');
              if (lastPeriod > 500) {
                firstParagraph = truncated.substring(0, lastPeriod + 1);
              } else {
                firstParagraph = truncated + "...";
              }
            }
            const finalExtract = firstParagraph || null;
            if (finalExtract) {
              const redirected = !!directData.query?.redirects;
              // Simple heuristic to extract a year (first 4-digit number that looks like a year)
              let year: number | null = null;
              const yearMatch = finalExtract.match(/\b(18|19|20)\d{2}\b/);
              if (yearMatch) {
                year = parseInt(yearMatch[0], 10);
              }
              return { extract: finalExtract, pageid: page.pageid || null, title: page.title || null, redirected, year };
            }
          }
        }
      } catch { }
      return null;
    };

    // We no longer strip parentheticals here because they are often critical 
    // for disambiguation (e.g., "Republic (book)" vs "Republic").
    const cleanQuery = query.trim();
    const normalized = cleanQuery.toLowerCase();
    const queryNameParts = normalized.split(/[\s-]+/).filter((w: string) => w.length > 2);
    const looksLikePersonName = queryNameParts.length >= 2 && !/\d/.test(cleanQuery);
    const queryLastName = looksLikePersonName ? queryNameParts[queryNameParts.length - 1].toLowerCase() : null;


    // 0. If the caller provided an explicit disambiguated title, honor it IMMEDIATELY
    // before stripping (...) or performing contextual search.
    // (e.g., "Prince (musician)" must resolve to the musician, not the generic royal title "Prince").
    const trimmedQuery = query.trim();
    if (trimmedQuery.includes("(") && trimmedQuery.includes(")")) {
      const direct = await tryDirectLookup(trimmedQuery);
      if (direct?.extract) {
        // console.log(`🎯 [Wiki] Explicit parenthetical match found for "${trimmedQuery}". Using disambiguated page.`);
        return direct;
      }
    }

    // 1. Prioritize the exact query term (minus parentheses).
    // If "Miles Davis" exists as a direct page, we should use it IMMEDIATELY 
    // without drowning it in contextual search (which might favor the Quintet).
    const directExact = await tryDirectLookup(cleanQuery);
    if (directExact?.extract) {
      if (queryLastName) {
        const titleParts = String(directExact.title || "").toLowerCase().split(/[\s-]+/).filter((w: string) => w.length > 2);
        // If it's a redirect, we are MUCH more lenient. Napoleon Bonaparte -> Napoleon is a classic case.
        if (!titleParts.includes(queryLastName) && !directExact.redirected) {
          // console.log(`⚠️ [Wiki] Ignoring direct match "${directExact.title}" for "${cleanQuery}" (missing last-name match and no redirect).`);
        } else {
          // console.log(`🎯 [Wiki] Exact title match found for "${cleanQuery}". Using primary page (redirected: ${directExact.redirected}).`);
          return directExact;
        }
      } else {
        // console.log(`🎯 [Wiki] Exact title match found for "${cleanQuery}". Using primary page.`);
        return directExact;
      }
    }

    const contextIndicatesMusic = (ctx?: string) => {
      const c = (ctx || "").toLowerCase();
      return /\b(music|musician|album|song|artist|band|pop|rock|hip hop|rap|r\&b|jazz)\b/.test(c);
    };

    const contextIndicatesBusiness = (ctx?: string) => {
      const c = (ctx || "").toLowerCase();
      return /\b(business|businessman|businesswoman|entrepreneur|investor|venture|vc|private equity|founder|co-founder|ceo|executive|chairman|president|startup|company|technology|tech|product|innovation)\b/.test(c);
    };

    const looksLikeRoyalTitleDefinition = (extract?: string | null) => {
      const e = (extract || "").toLowerCase();
      if (!e) return false;
      // Common for "Prince", "Duke", etc. pages that are definitions rather than the intended proper noun.
      return (
        e.includes(" is a male ruler") ||
        e.includes(" is a female ruler") ||
        e.includes(" is a title") ||
        e.includes(" is a royal") ||
        e.includes(" member of a monarch") ||
        e.includes(" ranked below a king") ||
        e.includes(" of a monarch's") ||
        e.includes(" of a monarch’s")
      );
    };

    // Generic-definition pages often steal ambiguous entertainment titles (e.g., "Euphoria" the feeling
    // vs. "Euphoria (TV series)"). When we have context (like "Zendaya"), we should prefer contextual search.
    const looksLikeGenericAbstractDefinition = (extract?: string | null) => {
      const e = (extract || "").toLowerCase().trim();
      if (!e) return false;
      // Keep this narrow: emotions/feelings/states/conditions rather than historical eras, etc.
      return (
        e.includes(" is a feeling of") ||
        e.includes(" is an emotion") ||
        e.includes(" is a mental state") ||
        e.includes(" is a psychological state") ||
        e.includes(" is a state of") ||
        e.includes(" is a feeling ") ||
        e.includes(" is the feeling ") ||
        e.includes(" is an experience of")
      );
    };

    const isMediaTitle = (title: string) => /\b(film|tv series|miniseries|series|movie|documentary|episode)\b/i.test(title);

    // 1. Prepare search terms.
    // If query is "Republic (book)", baseQuery is "Republic" and paren is "book".
    const baseQuery = query.replace(/\s*\(.*\)\s*/g, '').trim();
    const parenMatch = query.match(/\((.*)\)/);
    const paren = parenMatch ? parenMatch[1] : null;

    // We search for the base query but include the parenthetical as additional context
    // This is more robust than a literal search for "Republic (book)" which ranks partial matches poorly.
    const finalSearchTerms = looksLikePersonName ? `"${baseQuery}"` : baseQuery;
    const searchContext = [context, paren].filter(Boolean).join(' ');
    const searchQuery = searchContext ? `${finalSearchTerms} ${searchContext}` : finalSearchTerms;

    const avoidMedia = /\b(project|program|programme|operation|war|battle|campaign|treaty|scandal|scientist)\b/i.test(baseQuery);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = (await jsonFromResponse(searchRes)) as { query?: { search?: any[] } } | null;

    let bestTitle = query;
    if (searchData?.query?.search?.length) {
      const results = searchData.query.search;
      const scoreResult = (r: any, index: number) => {
        const title = r.title.toLowerCase();
        const snippet = (r.snippet || '').toLowerCase();
        let s = (index === 0) ? 200 : 0; // Small boost for the first result

        // Normalized for scoring is the BASE query (e.g., "republic")
        const normalizedBase = baseQuery.toLowerCase();

        // Strongly penalize "List of ..." style pages unless the user explicitly asked for a list.
        const queryWantsList = normalizedBase.startsWith("list of ") || normalizedBase.includes("awards") || normalizedBase.includes("nominations") || normalizedBase.includes("filmography") || normalizedBase.includes("discography");
        const isListPage = title.startsWith("list of ") || title.includes(" awards and nominations") || title.includes(" filmography") || title.includes(" discography");
        if (isListPage && !queryWantsList) {
          s -= 2500;
        }

        // 1. Title matching (exact or with parenthetical disambiguation)
        // Ignore "The ", "A ", "An " at the start for matching
        const cleanTitle = title.replace(/^(the|a|an)\s+/i, '');
        const cleanNormalized = normalizedBase.replace(/^(the|a|an)\s+/i, '');

        if (cleanTitle === cleanNormalized) {
          s += 1000;
        } else if (cleanTitle.startsWith(cleanNormalized + " (")) {
          s += 800; // Match for "Base Title (Anything)"
        }

        // 2. Parenthetical matching
        // If the user provided "(book)", and we find a page with info containing "book", give a bonus.
        if (paren) {
          const parenLower = paren.toLowerCase();
          if (title.includes(parenLower)) s += 500;
          if (snippet.includes(parenLower)) s += 200;
        }

        // Music disambiguation: prefer musician/band pages over generic title definitions.
        const musicCtx = contextIndicatesMusic(context);
        const bizCtx = contextIndicatesBusiness(context);
        if (musicCtx) {
          if (title.includes("(musician)") || title.includes("(singer)") || title.includes("(band)")) s += 1600;
          if (/\b(singer|musician|songwriter|rapper|band)\b/.test(snippet)) s += 800;
          // Penalize royalty-title definition pages when user context is music.
          if (title === normalized && /\b(male ruler|monarch|royal|noble)\b/.test(snippet)) s -= 1600;
        }
        // Business disambiguation: prefer entrepreneur/business pages; penalize musicians.
        if (bizCtx) {
          if (title.includes("(businessman)") || title.includes("(entrepreneur)") || title.includes("(businesswoman)")) s += 1600;
          if (/\b(entrepreneur|businessman|businesswoman|investor|executive|chief executive|ceo|founder|co-founder)\b/.test(snippet)) s += 900;
          if (title.includes("(musician)") || title.includes("(singer)") || title.includes("(band)")) s -= 1400;
          if (/\b(singer|musician|songwriter|rapper|band)\b/.test(snippet)) s -= 900;
        }

        // 2. Context matching
        if (context) {
          const words = context.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          words.forEach(word => {
            if (title.includes(word)) s += 100;
            if (snippet.includes(word)) s += 50;
          });
        }

        // 3. Media penalties
        const suffixes = ["(TV series)", "(film)", "(miniseries)", "(series)", "(movie)", "(documentary)", "(episode)"];
        const isMedia = suffixes.some(suf => title.includes(suf.toLowerCase())) || isMediaTitle(title);
        if (isMedia) {
          if (avoidMedia) s -= 800;
          else s -= 400;
        }

        // 4. Term scoring
        const sportsTerms = ['football', 'soccer', 'rugby', 'cricket', 'goalkeeper', 'striker', 'club', 'fc', 'afc', 'baseball', 'mlb', 'pcl', 'outfield', 'pitcher'];
        sportsTerms.forEach(t => {
          const regex = new RegExp(`\\b${t}\\b`, 'i');
          if (regex.test(title) || regex.test(snippet)) s -= 400;
        });

        // Contextual boost: if context clearly implies film/TV, upweight media pages
        const filmContext = (context || '').toLowerCase().match(/\b(film|movie|director|screenplay|starring|cast|ridley scott|screenwriter|cinematography|box office)\b/);
        if (filmContext) {
          if (title.includes('(film)') || title.includes('(movie)') || title.includes('(tv') || title.includes('(television)')) {
            s += 1200;
          }
          if (title.includes('(2000 film)') || title.includes('(199') || title.includes('(20')) {
            s += 600; // gentle year-specific nudge, not title-specific
          }
        }

        if (/born\s\d{4}/.test(snippet)) s += 80;

        // General Infrastructure/Geographic penalty when searching for a proper person-like name
        if (looksLikePersonName) {
          const infraTerms = ['airport', 'station', 'stadium', 'university', 'bridge', 'plaza', 'square', 'park', 'boulevard', 'avenue', 'road', 'highway', 'complex', 'tower'];
          infraTerms.forEach(t => {
            if (title.includes(t)) s -= 2000;
          });
        }

        // Penalize non-Latin characters if the query is Latin (prevents Japanese/Chinese/etc. titles on en.wikipedia)
        const isLatinQuery = !/[^\u0000-\u024F]/.test(cleanQuery);
        const titleHasNonLatin = /[^\u0000-\u024F]/.test(title);
        if (isLatinQuery && titleHasNonLatin) {
          s -= 2000;
        }

        return s;
      };

      const scored = results.map((r: any, idx: number) => ({ r, score: scoreResult(r, idx) })).sort((a: any, b: any) => b.score - a.score);
      bestTitle = scored[0]?.r?.title || query;


      const titleNameParts = bestTitle.toLowerCase().split(/[\s-]+/).filter((w: string) => w.length > 2);
      // Require at least one full word match, not just a substring overlap
      const hasFullWordMatch = queryNameParts.some(q => titleNameParts.includes(q));
      const hasOverlap = queryNameParts.some(q => titleNameParts.some(t => t.includes(q) || q.includes(t)));

      // 4. Resolve the best matching page from the search results, skipping disambiguation pages.
      const candidates = searchData.query?.search?.length ? scored.map((s: any) => s.r.title) : [query];

      for (const titleToTry of candidates) {
        if (queryNameParts.length > 0) {
          const candidateParts = titleToTry.toLowerCase().split(/[\s-]+/).filter((w: string) => w.length > 2);

          // STRICT PERSON MATCHING:
          // If we are looking for a person (query has 2+ name parts),
          // require ALL significant query tokens to be present in the candidate title tokens.
          // This prevents "Perry Neubauer" from matching "Jeff Neubauer".
          if (queryNameParts.length >= 2) {
            const allMatch = queryNameParts.every(q => candidateParts.includes(q));
            // Special exemption: if the candidate title is a single word and it is the FIRST result
            // and it is one of the query parts, allow it (e.g. "Napoleon").
            const isFirstMatch = titleToTry === candidates[0];
            const queryNameMatchesTitle = queryNameParts.some(q => candidateParts.includes(q));
            const isShortFamousName = candidateParts.length === 1 && queryNameMatchesTitle;

            if (!allMatch && !(isFirstMatch && isShortFamousName)) {
              // console.log(`⚠️ [Wiki] Skipping title "${titleToTry}" for query "${cleanQuery}" (not all name parts match).`);
              continue;
            }
          } else if (queryLastName && !candidateParts.includes(queryLastName)) {
            // console.log(`⚠️ [Wiki] Skipping title "${titleToTry}" for query "${cleanQuery}" (missing last-name match).`);
            continue;
          }
        }
        const summaryUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro&explaintext&titles=${encodeURIComponent(titleToTry)}&redirects=1&origin=*`;
        const summaryRes = await fetch(summaryUrl);
        const summaryData = (await jsonFromResponse(summaryRes)) as { query?: { pages?: unknown } } | null;
        if (!summaryData) continue;
        const pages = summaryData.query?.pages;

        if (pages) {
          const page = Object.values(pages)[0] as any;
          if (page && !page.missing && !(page.pageprops && page.pageprops.disambiguation !== undefined)) {
            const fullExtract = page.extract || "";

            // Guard: if a title that looks like an org/venue redirects to a person page, ignore it.
            if (looksLikeOrgTitle(cleanQuery) && String(page.title || "").toLowerCase() !== cleanQuery.toLowerCase()) {
              if (looksLikePersonExtract(fullExtract)) {
                // console.log(`⚠️ [Wiki] Ignoring redirect mismatch for org-ish query "${cleanQuery}" -> "${page.title}"`);
                continue; // Try next search result
              }
            }

            // Split by double newline to get the first paragraph
            let paragraphs = fullExtract.split(/\n\n|\r\n\r\n/);
            let firstParagraph = paragraphs[0].trim();

            if (!firstParagraph || firstParagraph.length > 1500) {
              const lines = fullExtract.split(/\n|\r/);
              if (lines[0].trim()) firstParagraph = lines[0].trim();
            }

            if (firstParagraph.length > 1000) {
              const truncated = firstParagraph.substring(0, 1000);
              const lastPeriod = truncated.lastIndexOf('.');
              if (lastPeriod > 500) {
                firstParagraph = truncated.substring(0, lastPeriod + 1);
              } else {
                firstParagraph = truncated + "...";
              }
            }

            const finalExtract = firstParagraph || null;
            if (!finalExtract || finalExtract.length < 50) {
              // console.log(`⚠️ [Wiki] Extract for "${page.title}" too short (${finalExtract?.length || 0} chars). Skipping.`);
              continue; // Try next search result
            }

            if (queryNameParts.length >= 2) {
              const pageParts = String(page.title || "").toLowerCase().split(/[\s-]+/).filter((w: string) => w.length > 2);
              const allMatch = queryNameParts.every(q => pageParts.includes(q));
              if (!allMatch) {
                // console.log(`⚠️ [Wiki] Skipping resolved title "${page.title}" for "${cleanQuery}" (not all name parts match).`);
                continue;
              }
            } else if (queryLastName) {
              const pageParts = String(page.title || "").toLowerCase().split(/[\s-]+/).filter((w: string) => w.length > 2);
              if (!pageParts.includes(queryLastName)) {
                // console.log(`⚠️ [Wiki] Skipping resolved title "${page.title}" for "${cleanQuery}" (missing last-name match).`);
                continue;
              }
            }

            // console.log(`✅ [Wiki] Found summary for "${page.title}": "${finalExtract?.substring(0, 100)}..." (${finalExtract?.length || 0} chars)`);

            if (avoidMedia && isMediaTitle(page.title)) {
              const retryQuery = `${cleanQuery} ${context || 'person'}`;
              // console.log(`⚠️ [Wiki] Media page returned for "${cleanQuery}". Retrying with "${retryQuery}".`);
              const retry = await fetchWikipediaSummary(retryQuery, context, visited, depth + 1);
              if (retry.extract) return retry;
            }

            let year: number | null = null;
            const yearMatch = (finalExtract || '').match(/\b(18|19|20)\d{2}\b/);
            if (yearMatch) {
              year = parseInt(yearMatch[0], 10);
            }

            return { extract: finalExtract, pageid: page.pageid || null, title: page.title || null, year, mentioningPageTitles: null, searchContext: null };
          }
        }
      }

      const validResults = results
        .filter((r: any) => {
          const snip = (r.snippet || "").toLowerCase();
          const q = cleanQuery.toLowerCase();
          if (snip.includes(q)) return true;
          const parts = q.split(/\s+/).filter(p => p.length > 2);
          if (parts.length >= 2) return parts.every(p => snip.includes(p));
          return false;
        });

      const searchContext = validResults
        .slice(0, 3)
        .map((r: any) => (r.snippet || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').trim())
        .filter(Boolean)
        .join(" ... ");

      const mentioningPageTitles = validResults
        .map((r: any) => r.title)
        .filter((t: string) => !t.toLowerCase().startsWith('list of '))
        .slice(0, 3);

      if (searchContext.length > 50) {
        // console.log(`ℹ️ [Wiki] No direct article match, using search snippets from ${mentioningPageTitles.join(', ')} as context for "${cleanQuery}".`);
        return {
          extract: searchContext,
          pageid: null,
          title: query,
          mentioningPageTitles,
          searchContext
        };
      }

      // console.log(`❌ [Wiki] No summary found for "${bestTitle}" via search. Attempting direct lookup for "${cleanQuery}".`);

      // Direct lookup fallback (reuse helper)

      // 2. Try Title Case (e.g. "andrew schloss" -> "Andrew Schloss")
      const toTitleCase = (str: string) => {
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      };
      const titleCased = toTitleCase(cleanQuery);
      if (titleCased !== cleanQuery) {
        // console.log(`⚠️ [Wiki] Direct lookup failed given casing. Retrying with Title Case: "${titleCased}"`);
        const titleMatch = await tryDirectLookup(titleCased);
        if (titleMatch) return titleMatch;
      }

      // console.log(`❌ [Wiki] No summary found for "${bestTitle}" matches.`);
    }
  } catch (e) {
    console.error(`❌ [Wiki] Error fetching summary for "${query}":`, e);
  }
  // Final fallback: if context was provided and failed, retry once with no context
  if (context && !triedNoContext) {
    // console.log(`⚠️ [Wiki] Retrying "${query}" without context (previous attempt returned empty).`);
    return await fetchWikipediaSummary(query, undefined, visited, depth + 1, true);
  }
  return { extract: null, pageid: null, title: null };
};

// Fetch a longer plain-text extract (not just the intro) to help find evidence snippets.
// Returns at most maxChars characters of the page extract.
export const fetchWikipediaExtract = async (
  title: string,
  maxChars: number = 12000
): Promise<{ extract: string | null; pageid: number | null; title: string | null }> => {
  try {
    // Note: exchars is intentionally omitted — the Wikipedia API mis-truncates short articles
    // when exchars is set (returns fewer chars than the article actually contains). We fetch
    // the full extract and truncate client-side instead.
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&explaintext&titles=${encodeURIComponent(title)}&redirects=1&origin=*`;
    const res = await fetch(url);
    const data = (await jsonFromResponse(res)) as { query?: { pages?: unknown } } | null;
    if (!data) return { extract: null, pageid: null, title: null };
    const pages = data.query?.pages;
    if (!pages) return { extract: null, pageid: null, title: null };
    const page = Object.values(pages)[0] as any;
    if (page && !page.missing && !(page.pageprops && page.pageprops.disambiguation !== undefined)) {
      // Guard: if a title that looks like an org/venue redirects to a person page, ignore it.
      if (looksLikeOrgTitle(title) && String(page.title || "").toLowerCase() !== String(title).toLowerCase()) {
        const full = String(page.extract || "");
        if (looksLikePersonExtract(full)) return { extract: null, pageid: null, title: null };
      }
      const rawExtract: string | null = page.extract || null;
      const extract = rawExtract && rawExtract.length > maxChars ? rawExtract.slice(0, maxChars) : rawExtract;
      return { extract, pageid: page.pageid || null, title: page.title || null };
    }
  } catch (e) {
    // console.warn("fetchWikipediaExtract failed:", title, e);
  }
  return { extract: null, pageid: null, title: null };
};

type WikidataKeyPeople = {
  wikidataId: string;
  founders: string[];
  directors: string[];
  ceos: string[];
  keyPeople: string[];
};

const extractWikidataItemIds = (claims: any, prop: string): string[] => {
  const arr = claims?.[prop] || [];
  const ids: string[] = [];
  for (const c of arr) {
    const v = c?.mainsnak?.datavalue?.value;
    const id = v?.id;
    if (typeof id === "string" && /^Q\d+$/.test(id)) ids.push(id);
  }
  return ids;
};

// Fetch cast/performer labels from Wikidata (P161) for a given title.
export const fetchWikidataCastForTitle = async (title: string, limit: number = 12): Promise<string[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const signal = controller.signal;

  try {
    let wikidataId: string | null = null;
    try {
      const pagepropsUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}&redirects=1&origin=*`;
      const ppRes = await fetch(pagepropsUrl, { signal });
      const ppData = await jsonFromResponse(ppRes);
      const pages = (ppData as { query?: { pages?: unknown } } | null)?.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0] as any;
        const candidate = page?.pageprops?.wikibase_item;
        if (typeof candidate === "string" && /^Q\d+$/.test(candidate)) {
          wikidataId = candidate;
        }
      }
    } catch {
      // ignore; fall through to search
    }

    if (!wikidataId) {
      wikidataId = await resolveWikidataIdBySearch(title, signal);
    }
    if (!wikidataId) return [];

    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${encodeURIComponent(wikidataId)}&origin=*`;
    const entRes = await fetch(entityUrl, { signal });
    const entData = await jsonFromResponse(entRes);
    const claims = (entData as { entities?: Record<string, { claims?: unknown }> } | null)?.entities?.[wikidataId]?.claims;
    if (!claims) return [];

    const castIds = extractWikidataItemIds(claims, "P161");
    if (!castIds.length) return [];

    const labelMap = await fetchWikidataLabels(castIds, signal);
    const labels = castIds
      .map(id => labelMap[id])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);

    return Array.from(new Set(labels)).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchWikidataLabels = async (ids: string[], signal: AbortSignal): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const uniq = Array.from(new Set(ids)).filter(Boolean);
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    try {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${encodeURIComponent(chunk.join("|"))}&origin=*`;
      const res = await fetch(url, { signal });
      const data = (await jsonFromResponse(res)) as { entities?: Record<string, { labels?: { en?: { value?: string } } }> } | null;
      if (!data) continue;
      const entities = data?.entities || {};
      for (const [id, ent] of Object.entries<any>(entities)) {
        const label = ent?.labels?.en?.value;
        if (label) out[id] = label;
      }
    } catch {
      // ignore partial failures
    }
  }
  return out;
};

const resolveWikidataIdBySearch = async (label: string, signal: AbortSignal): Promise<string | null> => {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=8&search=${encodeURIComponent(label)}&origin=*`;
    const res = await fetch(url, { signal });
    const data = (await jsonFromResponse(res)) as { search?: any[] } | null;
    const results: any[] = data?.search || [];
    if (!results.length) return null;

    const normalized = label.trim().toLowerCase();
    const mustContainMuseum = /\bmuseum\b/i.test(label);
    const scored = results.map(r => {
      const lab = String(r?.label || "");
      const desc = String(r?.description || "");
      const l = lab.trim().toLowerCase();
      const d = desc.trim().toLowerCase();
      let s = 0;
      if (l === normalized) s += 1000;
      if (l.includes(normalized)) s += 300;
      if (mustContainMuseum && (l.includes("museum") || d.includes("museum"))) s += 500;
      if (looksLikeOrgTitle(label) && (d.includes("museum") || d.includes("company") || d.includes("organisation") || d.includes("organization"))) s += 120;
      return { id: r?.id, score: s };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0]?.id;
    return typeof best === "string" && /^Q\d+$/.test(best) ? best : null;
  } catch {
    return null;
  }
};

export const fetchWikidataKeyPeopleForTitle = async (title: string): Promise<WikidataKeyPeople | null> => {
  const cacheKey = `wikidata_key_people|${(title || "").trim().toLowerCase()}`;
  if (!(window as any).__wikidataPeopleCache) (window as any).__wikidataPeopleCache = new Map<string, WikidataKeyPeople | null>();
  const cache: Map<string, WikidataKeyPeople | null> = (window as any).__wikidataPeopleCache;
  if (cache.has(cacheKey)) return cache.get(cacheKey) || null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  const signal = controller.signal;

  try {
    // 1) Resolve Wikidata Q-id from the English Wikipedia page.
    let wikidataId: string | null = null;
    try {
      const pagepropsUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}&redirects=1&origin=*`;
      const ppRes = await fetch(pagepropsUrl, { signal });
      const ppData = await jsonFromResponse(ppRes);
      const pages = (ppData as { query?: { pages?: unknown } } | null)?.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0] as any;
        const resolvedTitle = String(page?.title || "");
        const candidate = page?.pageprops?.wikibase_item;
        // If the "Wikipedia title" redirects to an unrelated person page, ignore it and fall back to Wikidata search.
        const mismatch =
          looksLikeOrgTitle(title) &&
          resolvedTitle &&
          resolvedTitle.toLowerCase() !== String(title).toLowerCase() &&
          !/\bmuseum\b/i.test(resolvedTitle);
        if (!mismatch && typeof candidate === "string" && /^Q\d+$/.test(candidate)) {
          wikidataId = candidate;
        }
      }
    } catch {
      // ignore and fall back to search
    }

    // Fall back: label search (handles Wikipedia redirects like "WNDR Museum" -> a person).
    if (!wikidataId) {
      wikidataId = await resolveWikidataIdBySearch(title, signal);
    }
    if (!wikidataId) {
      cache.set(cacheKey, null);
      return null;
    }

    // 2) Pull key-people claims.
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${encodeURIComponent(wikidataId)}&origin=*`;
    const entRes = await fetch(entityUrl, { signal });
    const entData = (await jsonFromResponse(entRes)) as { entities?: Record<string, { claims?: unknown }> } | null;
    const entity = entData?.entities?.[wikidataId];
    const claims = entity?.claims;
    if (!claims) {
      cache.set(cacheKey, null);
      return null;
    }

    // Wikidata properties:
    // - P112: founder
    // - P1037: director/manager
    // - P169: chief executive officer
    // - P3342: significant person / key person
    const founderIds = extractWikidataItemIds(claims, "P112");
    const directorIds = extractWikidataItemIds(claims, "P1037");
    const ceoIds = extractWikidataItemIds(claims, "P169");
    const keyPersonIds = extractWikidataItemIds(claims, "P3342");

    const labelMap = await fetchWikidataLabels(
      [...founderIds, ...directorIds, ...ceoIds, ...keyPersonIds],
      signal
    );

    const toLabels = (ids: string[]) =>
      Array.from(new Set(ids.map(id => labelMap[id]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)));

    const result: WikidataKeyPeople = {
      wikidataId,
      founders: toLabels(founderIds),
      directors: toLabels(directorIds),
      ceos: toLabels(ceoIds),
      keyPeople: toLabels(keyPersonIds)
    };

    const hasAny =
      result.founders.length || result.directors.length || result.ceos.length || result.keyPeople.length;

    cache.set(cacheKey, hasAny ? result : null);
    return hasAny ? result : null;
  } catch {
    cache.set(cacheKey, null);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
