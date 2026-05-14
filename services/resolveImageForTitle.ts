import { jsonFromResponse } from "./aiUtils";

type ImageResolveResult = { url: string | null; source?: string };

/** Identifiable UA — Wikimedia rate-limits shared / anonymous clients heavily when parallel bursts hit. */
const WIKI_UA = "Constellations/1.0 (knowledge graph; +https://www.mediawiki.org/wiki/API:Etiquette)";

/** Limit parallel MediaWiki API calls (many image nodes = many /api/image requests on the server at once). */
const WIKI_MAX_CONCURRENT = 3;
let wikiInFlight = 0;
const wikiWaitQueue: Array<() => void> = [];
function acquireWiki(): Promise<void> {
  if (wikiInFlight < WIKI_MAX_CONCURRENT) {
    wikiInFlight++;
    return Promise.resolve();
  }
  return new Promise((res) => wikiWaitQueue.push(res));
}
function releaseWiki() {
  wikiInFlight--;
  const n = wikiWaitQueue.shift();
  if (n) {
    wikiInFlight++;
    n();
  }
}

/**
 * JSON GET for api.php with 429/503 retry (Retry-After or exponential backoff) and concurrency gate.
 */
async function wikimediaGetJson(url: string): Promise<unknown | null> {
  await acquireWiki();
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(url, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
      if (res.status === 429 || res.status === 503) {
        const ra = res.headers.get("Retry-After");
        let ms: number;
        if (ra) {
          const sec = parseInt(ra.trim(), 10);
          if (!Number.isNaN(sec) && /^\d+$/.test(ra.trim())) {
            ms = Math.min(120_000, sec * 1000);
          } else {
            const httpDate = Date.parse(ra);
            ms = !Number.isNaN(httpDate) ? Math.max(200, httpDate - Date.now()) : 2000;
          }
        } else {
          ms = Math.min(20_000, 500 * 2 ** attempt) + Math.random() * 300;
        }
        await new Promise((r) => setTimeout(r, ms));
        continue;
      }
      if (!res.ok) {
        if (attempt < 5 && res.status >= 500 && res.status < 600) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  } finally {
    releaseWiki();
  }
}

/** Short-lived: avoid duplicate pageprops lookup when one graph fires many /api/image for related titles. */
const pagepropsQidCache = new Map<string, { qid: string; at: number }>();
const QID_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
function cacheGetQid(titleKey: string): string | undefined {
  const e = pagepropsQidCache.get(titleKey);
  if (!e) return undefined;
  if (Date.now() - e.at > QID_CACHE_TTL_MS) {
    pagepropsQidCache.delete(titleKey);
    return undefined;
  }
  return e.qid;
}
function cacheSetQid(titleKey: string, qid: string) {
  pagepropsQidCache.set(titleKey, { qid, at: Date.now() });
}

export const fetchDuckDuckGoImages = async (
  q: string,
  limit: number = 10
): Promise<Array<{ image?: string; thumbnail?: string; title?: string }>> => {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Accept-Language": "en-US,en;q=0.9"
  };
  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`;
    const pageRes = await fetch(searchUrl, { headers });
    if (!pageRes.ok) {
      console.warn("[DDG-Test] search status", pageRes.status, q);
      return [];
    }
    const pageText = await pageRes.text();
    const vqdMatch = pageText.match(/vqd=['"]?([^'"&]+)/);
    const vqd = vqdMatch?.[1];
    if (!vqd) {
      console.warn("[DDG-Test] missing vqd for query", q);
      return [];
    }

    const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
    const apiRes = await fetch(apiUrl, {
      headers: {
        ...headers,
        Referer: searchUrl,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (!apiRes.ok) {
      console.warn("[DDG-Test] api status", apiRes.status, q);
      return [];
    }
    const data = (await jsonFromResponse(apiRes)) as { results?: any[] } | null;
    if (!data) return [];
    const results: any[] = data?.results || [];
    return results.slice(0, limit).map((r) => ({
      image: r?.image,
      thumbnail: r?.thumbnail,
      title: r?.title
    }));
  } catch {
    return [];
  }
};

const fetchPosterFromDuckDuckGo = async (q: string): Promise<string | null> => {
  const exclude = ["logo", "icon", "emoji", "svg", "vector", "clipart", "cartoon", "animated", "posterized"];
  try {
    const candidates = await fetchDuckDuckGoImages(q, 10);
    console.log("[Poster][DDG] results", candidates.length);
    for (const r of candidates) {
      const url = String(r?.image || r?.thumbnail || "");
      if (!url) continue;
      const lower = url.toLowerCase();
      if (exclude.some((p) => lower.includes(p))) continue;
      console.log(`[Poster][DDG] candidate`, { url: r?.image, thumbnail: r?.thumbnail, title: r?.title });
      return url;
    }
  } catch (e) {
    console.warn("[Poster][DDG] failed", q, e);
  }
  return null;
};

export const resolveImageForTitle = async (title: string, context: string): Promise<ImageResolveResult> => {
  const trimmedTitle = title.trim();
  const trimmedContext = context.trim();
  const looksLikeScreenWork = (s: string) =>
    /\b(film|movie|television series|tv series|miniseries|sitcom|drama series|comedy series|series)\b/i.test(s.toLowerCase());
  /** Types from the graph LLM: must include music/performance roles, not just "author|actor" */
  const isPersonContext = (s: string) => {
    const normalized = s.trim().toLowerCase();
    if (
      /^(person|human|author|actor|actress|musician|artist|rapper|singer|songwriter|vocalist|bandleader|entertainer|drummer|guitarist|pianist|bassist|lyricist|poet|composer|scientist|mathematician|researcher|band|group|athlete|politician|model|dancer|dj|mc|deejay|celebrity)$/i.test(
        normalized
      )
    ) {
      return true;
    }
    if (
      /\b(person|people|human|author|actor|actress|musicians?|rappers?|singers?|vocalists?|songwriters?|bandleaders?|entertainers?|composers?|artists?|director|writer|poet|playwright|drummers?|guitarists?|pianists?|bassists?|lyricists?|djs?|mcs?|vocalist|lyricist|bassist|orchestrators?|producers?|choreographer|dancers?|models?|athletes?|politicians?|disc jockey|scientist|mathematician|researcher|celebrity|celebrities|rap)\b/i.test(
        normalized
      ) ||
      /(hip[ -]hop|rap artist|grime artist|musical group|boy band|girl band)/i.test(normalized)
    ) {
      return true;
    }
    return false;
  };
  let isScreenWork = looksLikeScreenWork(`${trimmedTitle} ${trimmedContext}`);
  const isPerson = isPersonContext(trimmedContext);

  const fetchImageInfo = async (fileTitle: string): Promise<string | null> => {
    const apis = [`https://commons.wikimedia.org/w/api.php`, `https://en.wikipedia.org/w/api.php`];
    for (const api of apis) {
      try {
        const url = `${api}?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=800&origin=*`;
        const data = (await wikimediaGetJson(url)) as any;
        if (!data) continue;
        const pagesInfo = data?.query?.pages;
        const imgPage = pagesInfo ? (Object.values(pagesInfo)[0] as any) : null;
        const info = imgPage?.imageinfo?.[0];
        if (info?.thumburl || info?.url) return info.thumburl || info.url;
      } catch { /* ignore */ }
    }
    return null;
  };

  const resolveWikidataId = async (allowSearchFallback: boolean): Promise<string | null> => {
    const titleKey = trimmedTitle.toLowerCase();
    const fromCache = cacheGetQid(titleKey);
    if (fromCache !== undefined) {
      return fromCache;
    }
    try {
      const ppUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(trimmedTitle)}&redirects=1&origin=*`;
      const ppData = (await wikimediaGetJson(ppUrl)) as any;
      const pages = ppData?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      const qid = page?.pageprops?.wikibase_item;
      if (qid && /^Q\d+$/.test(qid)) {
        cacheSetQid(titleKey, qid);
        return qid;
      }
      // No wikibase_item on enwiki (common) — fall through to search when allowed
    } catch (e) {
      console.warn("[Image][Wikidata] pageprops failed", trimmedTitle, e);
    }

    if (allowSearchFallback) {
      try {
        const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&search=${encodeURIComponent(trimmedTitle)}&origin=*`;
        const data = (await wikimediaGetJson(searchUrl)) as any;
        const id = data?.search?.[0]?.id;
        if (id && /^Q\d+$/.test(id)) {
          cacheSetQid(titleKey, id);
          return id;
        }
      } catch (e) {
        console.warn("[Image][Wikidata] search failed", trimmedTitle, e);
      }
    }
    return null;
  };

  const fetchWikidataImageForTitle = async (allowSearchFallback: boolean): Promise<string | null> => {
    try {
      const qid = await resolveWikidataId(allowSearchFallback);
      if (!qid) return null;
      const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qid}&origin=*`;
      const wdData = (await wikimediaGetJson(wdUrl)) as any;
      if (!wdData) return null;
      const claims = wdData?.entities?.[qid]?.claims;
      const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
      if (!p18) return null;
      const imgTitle = p18.startsWith("File:") ? p18 : `File:${p18}`;
      return fetchImageInfo(imgTitle);
    } catch (e) {
      console.warn("[Image][Wikidata] failed", trimmedTitle, e);
      return null;
    }
  };

  const fetchWikipediaPageImage = async (): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(trimmedTitle)}&pithumbsize=800&redirects=1&origin=*`;
      const data = (await wikimediaGetJson(url)) as any;
      if (!data) return null;
      const pages = data?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      return page?.thumbnail?.source || null;
    } catch {
      return null;
    }
  };

  const fetchWikipediaExtract = async (): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(trimmedTitle)}&redirects=1&origin=*`;
      const data = (await wikimediaGetJson(url)) as any;
      if (!data) return null;
      const pages = data?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      return page?.extract || null;
    } catch {
      return null;
    }
  };

  const fetchWikipediaPosterFromImages = async (): Promise<string | null> => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&titles=${encodeURIComponent(trimmedTitle)}&imlimit=50&redirects=1&origin=*`;
      const data = (await wikimediaGetJson(url)) as any;
      if (!data) return null;
      const pages = data?.query?.pages;
      const page = pages ? (Object.values(pages)[0] as any) : null;
      const images = page?.images || [];
      if (!images.length) return null;

      const normalizedTitle = trimmedTitle.toLowerCase();
      const candidates = images
        .map((img: any) => String(img?.title || ""))
        .filter((t: string) => t.toLowerCase().startsWith("file:"));

      if (!candidates.length) return null;

      const scored = candidates
        .map((t: string) => {
          const lt = t.toLowerCase();
          let score = 0;
          if (lt.includes("poster")) score += 500;
          if (lt.includes("cover")) score += 200;
          if (lt.includes("film") || lt.includes("movie")) score += 150;
          if (lt.includes(normalizedTitle)) score += 200;

          const junk = ["museum", "car", "grill", "packard", "automobile", "vehicle", "display", "engine", "cockpit", "interior", "exterior", "restoration", "may_2017"];
          if (junk.some((j) => lt.includes(j))) score -= 1000;

          if (t.length > 100) score -= 400;

          if (lt.includes(".svg") || lt.includes(".webm") || lt.includes(".gif")) score -= 300;
          return { title: t, score };
        })
        .sort((a: any, b: any) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score <= 0) {
        console.warn(`[Image][Wiki-Poster] No good poster found for "${trimmedTitle}". Best score: ${best?.score || 0}`);
        return null;
      }
      return fetchImageInfo(best.title);
    } catch {
      return null;
    }
  };

  const fetchCommonsPoster = async (): Promise<string | null> => {
    try {
      const searchQuery = `"${trimmedTitle}" poster`;
      const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srnamespace=6&srlimit=5&origin=*`;
      const data = (await wikimediaGetJson(searchUrl)) as any;
      if (!data) return null;
      const hits: any[] = (data as any)?.query?.search || [];
      let best: { url: string; score: number; title: string } | null = null;
      const normalizedTitle = trimmedTitle.toLowerCase();
      for (const h of hits) {
        const fileTitle = h?.title;
        if (!fileTitle) continue;
        const lowerTitle = String(fileTitle).toLowerCase();
        if (lowerTitle.endsWith(".pdf") || lowerTitle.includes(".pdf/")) continue;
        const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url|size&iiurlwidth=800&origin=*`;
        const infoData = (await wikimediaGetJson(infoUrl)) as any;
        if (!infoData) continue;
        const pages = (infoData as any)?.query?.pages;
        const page = pages ? (Object.values(pages)[0] as any) : null;
        const info = page?.imageinfo?.[0];
        const url = info?.thumburl || info?.url;
        if (!url) continue;
        const w = Number(info?.thumbwidth || info?.width || 0);
        const hgt = Number(info?.thumbheight || info?.height || 0);
        const ratio = hgt > 0 && w > 0 ? hgt / w : 0;
        let score = 0;
        const lt = String(fileTitle).toLowerCase();
        if (lt.includes(normalizedTitle)) score += 180;
        if (lt.includes("poster")) score += 120;
        if (lt.includes("season")) score += 40;
        if (ratio > 1.2) score += 60;
        if (ratio < 0.9) score -= 150;
        if (w < 300 || hgt < 400) score -= 80;
        if (score <= 0) score = 10;
        if (!best || score > best.score) best = { url, score, title: fileTitle };
      }
      return best?.url || null;
    } catch {
      return null;
    }
  };

  const fetchCommonsPortrait = async (): Promise<string | null> => {
    try {
      const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(trimmedTitle)}&srnamespace=6&srlimit=10&origin=*`;
      const data = (await wikimediaGetJson(searchUrl)) as any;
      if (!data) return null;
      const hits: any[] = data?.query?.search || [];
      if (!hits.length) return null;
      const baseWords = trimmedTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      const scored = hits
        .map((h) => {
          const fileTitle = String(h?.title || "");
          const lt = fileTitle.toLowerCase();
          if (!lt.startsWith("file:")) return { title: fileTitle, score: -1000 };
          let score = 0;
          if (lt.includes("portrait") || lt.includes("photo") || lt.includes("headshot") || lt.includes("face")) score += 350;
          if (lt.includes("poster")) score -= 200;
          if (lt.includes("with") || lt.includes(" and ") || lt.includes(" group")) score -= 250;
          const matches = baseWords.filter((w) => lt.includes(w));
          if (matches.length < Math.min(2, baseWords.length)) score -= 400;
          score += (matches.length / Math.max(1, baseWords.length)) * 500;
          if (lt.includes(".jpg") || lt.includes(".jpeg")) score += 100;
          if (lt.includes(".png")) score -= 20;
          if (lt.includes(".svg") || lt.includes(".webm") || lt.includes(".gif")) score -= 300;
          const wordCount = lt.split(/[^a-z]/).filter((w) => w.length > 2).length;
          score -= wordCount * 15;
          return { title: fileTitle, score };
        })
        .sort((a: any, b: any) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score <= 0) return null;
      return fetchImageInfo(best.title);
    } catch {
      return null;
    }
  };

  if (trimmedTitle.toLowerCase().startsWith("file:") || trimmedTitle.toLowerCase().startsWith("image:")) {
    const fileUrl = await fetchImageInfo(trimmedTitle);
    return { url: fileUrl, source: fileUrl ? "file" : "file-miss" };
  }

  if (!isScreenWork && !isPerson) {
    const extract = await fetchWikipediaExtract();
    if (extract && looksLikeScreenWork(extract)) {
      isScreenWork = true;
    }
  }

  if (isPerson) {
    const fromPageImage = await fetchWikipediaPageImage();
    if (fromPageImage) return { url: fromPageImage, source: "pageimage" };
    const fromWikidata = await fetchWikidataImageForTitle(false);
    if (fromWikidata) return { url: fromWikidata, source: "wikidata" };
    const fromCommons = await fetchCommonsPortrait();
    if (fromCommons) return { url: fromCommons, source: "commons-portrait" };
    // Match non-`isPerson` branch: wikidata search + image search, or biographies stay blank too often
    const fromWikidataSearch = await fetchWikidataImageForTitle(true);
    if (fromWikidataSearch) return { url: fromWikidataSearch, source: "wikidata-search" };
    const fromDdg = await fetchPosterFromDuckDuckGo(trimmedTitle);
    if (fromDdg) return { url: fromDdg, source: "ddg-person" };
    return { url: null };
  }

  if (isScreenWork) {
    const fromEnwikiPoster = await fetchWikipediaPosterFromImages();
    if (fromEnwikiPoster) return { url: fromEnwikiPoster, source: "enwiki-images" };
    const fromCommons = await fetchCommonsPoster();
    if (fromCommons) return { url: fromCommons, source: "commons" };
    const fromWikidata = await fetchWikidataImageForTitle(false);
    if (fromWikidata) return { url: fromWikidata, source: "wikidata" };
    const fromPageImage = await fetchWikipediaPageImage();
    if (fromPageImage) return { url: fromPageImage, source: "pageimage" };
    const fromDdg = await fetchPosterFromDuckDuckGo(trimmedTitle);
    if (fromDdg) return { url: fromDdg, source: "ddg" };
    return { url: null };
  }

  const fromWikidata = await fetchWikidataImageForTitle(true);
  if (fromWikidata) return { url: fromWikidata, source: "wikidata" };
  const fromPageImage = await fetchWikipediaPageImage();
  if (fromPageImage) return { url: fromPageImage, source: "pageimage" };
  const fromCommons = await fetchCommonsPortrait();
  if (fromCommons) return { url: fromCommons, source: "commons" };
  const fromDdg = await fetchPosterFromDuckDuckGo(trimmedTitle);
  if (fromDdg) return { url: fromDdg, source: "ddg" };
  return { url: null };
};
