
// Helper to get environment cache URL
export const getEnvCacheUrl = () => {
    let url = "";
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            // @ts-ignore
            url = import.meta.env.VITE_CACHE_API_URL || "";
        }
    } catch (e) { }
    if (url) return url;
    try {
        if (typeof process !== 'undefined' && process.env) {
            url = process.env.VITE_CACHE_API_URL || "";
        }
    } catch (e) { }
    return url;
};

// Logic to determine effective cache base URL
// If running in extension, we might need a fixed URL or env var.
// For now, defaulting to localhost:4000 if not set, similar to App.tsx logic.
export const getEffectiveCacheBaseUrl = () => {
    const envUrl = getEnvCacheUrl();
    if (envUrl) return envUrl;
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        return 'http://localhost:4000';
    }
    if (typeof window !== 'undefined' && window.location.protocol === 'chrome-extension:') {
        return 'http://localhost:4000';
    }
    return "";
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
        console.warn("Cache fetch failed", e);
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
        console.warn("Cache save failed", e);
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
        console.warn("Node upsert failed", e);
        return null;
    }
};
