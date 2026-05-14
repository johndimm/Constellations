"use client";
import { getEffectiveCacheBaseUrl } from './cacheService';

export type ServerImageResult = {
    url: string | null;
    source?: string;
    pageId?: number;
    pageTitle?: string;
};

/**
 * Base URL for `GET /api/image` in the browser.
 * Prefer the current page (e.g. Next.js Soundings implements this route). The graph
 * cache server is for expansions / persistence; image lookup should not depend on it
 * when the host app can resolve Wikipedia images itself.
 */
export const getImageApiBaseUrl = (cacheBaseUrl: string | undefined): string => {
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return (
        (cacheBaseUrl && cacheBaseUrl.replace(/\/$/, '')) ||
        getEffectiveCacheBaseUrl() ||
        ''
    );
};

export const fetchServerImage = async (
    title: string,
    context?: string,
    baseUrl?: string
): Promise<ServerImageResult> => {
    if (!title) return { url: null };
    const resolvedBase =
        baseUrl ||
        getEffectiveCacheBaseUrl() ||
        (typeof window !== 'undefined' ? window.location.origin : '');
    if (!resolvedBase) return { url: null };
    try {
        const params = new URLSearchParams({ title });
        if (context) params.set('context', context);
        const url = new URL(`/api/image?${params.toString()}`, resolvedBase).toString();
        const res = await fetch(url);
        if (!res.ok || !String(res.headers.get('content-type') || '').includes('application/json')) {
            return { url: null };
        }
        const data = await res.json();
        return {
            url: data?.url ?? null,
            source: data?.source,
            pageId: data?.pageId,
            pageTitle: data?.pageTitle
        };
    } catch {
        return { url: null };
    }
};
