import { getEffectiveCacheBaseUrl } from './cacheService';

export type ServerImageResult = { url: string | null; source?: string };

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
        return { url: data?.url ?? null, source: data?.source };
    } catch {
        return { url: null };
    }
};
