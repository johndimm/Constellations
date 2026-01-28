export const normalizeForEvidence = (s: unknown) =>
    String(s || '')
        .toLowerCase()
        .replace(/[“”"]/g, '"')
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

export const splitIntoSentences = (text: string): string[] => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    // Improved sentence split that ignores common abbreviations
    const commonAbbreviations = ['Bros', 'Mr', 'Mrs', 'Ms', 'Dr', 'Sr', 'Jr', 'St', 'Prof', 'Capt', 'Col', 'Gen', 'Inc', 'Ltd', 'Co'];
    const abbrRegex = commonAbbreviations.join('|');
    const regex = new RegExp(`(?<!\\b(?:${abbrRegex}))[.!?](?=\\s+[A-Z]|$)`, 'g');

    const sentences: string[] = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(t)) !== null) {
        sentences.push(t.substring(lastIndex, match.index + 1).trim());
        lastIndex = match.index + 1;
    }
    if (lastIndex < t.length) {
        const remaining = t.substring(lastIndex).trim();
        if (remaining) sentences.push(remaining);
    }
    return sentences.filter(Boolean);
};

export const roleLooksLikeJobTitle = (s: unknown) =>
    /\b(president|ceo|chief|director|manager|founder|co-founder|curator|chairman|head)\b/i.test(String(s || ''));

export const sanitizeTitleParen = (title: string) => title.replace(/\s*\(([^)]+)\)\s*$/, '').trim();

export const isParenJobTitle = (title: unknown) => {
    const s = String(title || '');
    const m = s.match(/\(([^)]+)\)\s*$/);
    return !!m && roleLooksLikeJobTitle(m[1]);
};

export const stripJobTitleParen = (title: string) => title.replace(/\s*\(([^)]+)\)\s*$/, '').trim();

export const parentheticalLooksLikeJobTitle = (title: unknown) => {
    const s = String(title || '');
    const m = s.match(/\(([^)]+)\)\s*$/);
    if (!m) return false;
    return roleLooksLikeJobTitle(m[1]);
};

export const isEvidenceBacked = (snippet: unknown, verifiedNorm: string) => {
    const sn = normalizeForEvidence(snippet);
    if (!sn) return false;
    if (!verifiedNorm) return false;
    return verifiedNorm.includes(sn);
};

export const looksLikeSpecificPersonName = (title: unknown) => {
    const s = String(title || '').trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    // Exclude generic terms
    if (/\b(celebrity|celeb|celebrities|guests?|visitors?|staff|team|various|unknown)\b/.test(lower)) return false;

    // Allow parenthetical disambiguation, but evaluate the base name.
    const base = s.replace(/\s*\(.*\)\s*$/, '').trim();
    const parts = base.split(/\s+/).filter(Boolean);

    if (parts.length === 0) return false;

    if (parts.length === 1) {
        const name = parts[0];
        // Allow proper names (starts with capital) of at least 2 characters.
        return /^[A-Z]/.test(name) && name.length >= 2;
    }

    if (parts.some(p => p.length < 2)) return false;
    return true;
};

export const sanitizeEvidenceAndRole = (cn: any, verifiedNorm: string) => {
    const e = cn?.edge_meta?.evidence;
    const hasEvidence = e && e.kind && e.kind !== 'none' && (e.snippet || e.pageTitle);
    if (!hasEvidence) return cn;
    // Non-Wikipedia sources (e.g., OpenAlex) are handled separately and should not be
    // invalidated by Wikipedia-only snippet matching.
    if (String(e.kind) === 'openalex') return cn;

    const pageTitle = String(e.pageTitle || '');
    const snippet = String(e.snippet || '');
    const pageLooksNonWiki = pageTitle.includes(' - ') || /^https?:\/\//i.test(pageTitle);
    const backed = isEvidenceBacked(snippet, verifiedNorm);

    if (!backed || pageLooksNonWiki) {
        const next = { ...cn };
        // Drop unverified evidence.
        next.edge_meta = { ...(next.edge_meta || {}), evidence: { kind: 'none' } };
        // Drop role label if it looks like a job-title claim.
        if (roleLooksLikeJobTitle(next.edge_label)) next.edge_label = null;
        // If the node title itself is just a job-title parenthetical (unverified), strip it.
        if (typeof next.title === 'string' && parentheticalLooksLikeJobTitle(next.title)) {
            next.title = stripJobTitleParen(next.title);
        }
        return next;
    }
    return cn;
};
