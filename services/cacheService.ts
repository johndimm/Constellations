"use client";
import { getEnvCacheUrl } from "./aiUtils";

// Logic to determine effective cache base URL
// If running in extension, we might need a fixed URL or env var.
// For now, defaulting to localhost:4000 if not set, similar to App.tsx logic.
export const getEffectiveCacheBaseUrl = () => {
    return getEnvCacheUrl();
};

export const fetchCacheExpansion = async (sourceId: number, baseUrl: string) => {
    if (!baseUrl) return null;
    try {
        const url = new URL("/expansion", baseUrl);
        url.searchParams.set("sourceId", sourceId.toString());
        const res = await fetch(url.toString());
        if (!res.ok) return null;
        return res.json();
    } catch (e) {
        // console.warn("Cache fetch failed", e);
        return null;
    }
};

export const saveCacheExpansion = async (sourceId: number, nodesToSave: any[], baseUrl: string) => {
    if (!baseUrl) return null;
    try {
        const res = await fetch(new URL("/expansion", baseUrl).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sourceId,
                nodes: nodesToSave.map(n => ({
                    title: n.title || n.id,
                    type: n.type,
                    description: n.description || "",
                    year: n.year || null,
                    meta: n.meta || {},
                    wikipedia_id: n.wikipedia_id,
                    edge_label: n.edge_label || null,
                    edge_meta: n.edge_meta || null
                }))
            })
        });
        if (!res.ok) {
            const text = await res.text();
            return { ok: false, status: res.status, body: text };
        }
        return await res.json();
    } catch (e) {
        // console.warn("Cache save failed", e);
        return { ok: false, error: String(e) };
    }
};

export const upsertCacheNode = async (node: {
    title?: string;
    type?: string;
    description?: string | null;
    year?: number | null;
    meta?: Record<string, any> | null;
    wikipedia_id?: string | null;
}, baseUrl: string) => {
    if (!baseUrl) return null;
    try {
        const res = await fetch(new URL("/node", baseUrl).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(node)
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        // console.warn("Node upsert failed", e);
        return null;
    }
};
