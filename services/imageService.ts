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
 * Prefer the cache/proxy server when one is configured — it always implements /api/image.
 * Fall back to window.location.origin for Next.js host apps that implement the route locally.
 */
export const getImageApiBaseUrl = (cacheBaseUrl: string | undefined): string => {
    const cacheBase = (cacheBaseUrl && cacheBaseUrl.replace(/\/$/, '')) || getEffectiveCacheBaseUrl();
    if (cacheBase) return cacheBase;
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
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
