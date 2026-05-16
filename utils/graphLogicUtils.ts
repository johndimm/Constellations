"use client";
export const getLinkKey = (a: number | string, b: number | string) => {
    const s = String(a);
    const t = String(b);
    return s < t ? `${s}-${t}` : `${t}-${s}`;
};

export const looksLikeScreenWork = (title: string, desc?: string) => {
    const s = String(title || '').toLowerCase();
    const d = String(desc || '').toLowerCase();
    return (
        s.includes('(film)') || s.includes('(movie)') || s.includes('(tv series)') ||
        d.includes('film') || d.includes('movie') || d.includes('television series') || d.includes('tv series')
    );
};

/** Year from a Wikipedia-style title, e.g. "Django (1966 film)" → 1966 */
export function extractYearFromFilmTitle(title: string): number | null {
    const paren = title.match(/\((\d{4})\s*(?:film|movie|tv)/i);
    if (paren) return parseInt(paren[1], 10);
    const bare = title.match(/\b(18|19|20)\d{2}\b/);
    return bare ? parseInt(bare[0], 10) : null;
}

/**
 * Build a Wikipedia-friendly seed for films/TV (Trailer, etc.).
 * "Django" + 1966 → "Django (1966 film)" so we don't land on Django (2017 film).
 */
export function filmWorkSearchTerm(
    title: string,
    year?: number | null,
    type?: string | null
): string {
    const t = title.replace(/\s+/g, " ").trim();
    if (!t) return t;
    if (/\(\d{4}\s*(?:film|movie|tv)/i.test(t)) return t;
    const y = year ?? extractYearFromFilmTitle(t);
    if (!y) return t;
    const base = t.replace(/\s*\([^)]*\)\s*$/, "").trim() || t;
    const kind =
        type === "tv" || /\b(tv series|television)\b/i.test(String(type || ""))
            ? "TV series"
            : "film";
    return `${base} (${y} ${kind})`;
}

export const isBadListPage = (t?: string) => {
    const s = String(t || '').toLowerCase();
    if (!s) return false;
    if (s.startsWith('list of ')) return true;
    if (s.includes('acquired by google') || s.includes('companies acquired by google') || s.includes('acquisitions by google')) return true;
    return false;
};

export const clampToViewport = (x: number, y: number, margin = 50) => {
    if (typeof window === 'undefined') return { x, y };
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
        x: Math.max(margin, Math.min(x, w - margin)),
        y: Math.max(margin, Math.min(y, h - margin))
    };
};
