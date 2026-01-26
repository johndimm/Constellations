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
