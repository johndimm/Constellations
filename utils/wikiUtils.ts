"use client";
import { fetchWikipediaExtract } from '../services/wikipediaService';

export const buildWikiUrl = (title: string, wikipediaId?: string | number) => {
    if (wikipediaId) {
        // If we have an ID, we likely have the exact title too.
        return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    }
    // Fallback to search if no ID is present, to avoid 404s.
    return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(title)}`;
};

export const buildWikiSearchUrl = (title: string) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(title)}`;

export const looksLikeWikipediaTitle = (t: unknown) => {
    const s = String(t || '').trim();
    if (!s) return false;
    if (/^https?:\/\//i.test(s)) return false;
    // Web page titles frequently include " - " separators; Wikipedia titles rarely do.
    if (s.includes(' - ')) return false;
    if (s.length > 90) return false;
    return true;
};

const serverExtractCache = new Map<string, string | null>();

function getExtractCacheMap(): Map<string, string | null> {
    if (typeof window === 'undefined') {
        return serverExtractCache;
    }
    const w = window as unknown as { __wikiExtractCache?: Map<string, string | null> };
    if (!w.__wikiExtractCache) {
        w.__wikiExtractCache = new Map();
    }
    return w.__wikiExtractCache;
}

export const getExtractCached = async (title: string) => {
    const extractCache = getExtractCacheMap();
    const key = String(title || '').trim();
    if (!key) return null;
    if (extractCache.has(key)) return extractCache.get(key) || null;
    const ex = (await fetchWikipediaExtract(key, 6000)).extract || null;
    extractCache.set(key, ex);
    return ex;
};
