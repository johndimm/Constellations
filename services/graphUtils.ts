import { GraphNode, GraphLink } from '../types';

// Normalize string for deduplication:
// - Unicode normalize (so visually-identical strings match)
// - strip zero-width chars + NBSP
// - lower case
// - remove leading "the "
// - remove punctuation (Unicode-aware)
// - collapse whitespace
export const normalizeForDedup = (str: unknown) => {
    let s = String(str ?? '');
    try {
        // Normalize to reduce visually-identical variants (e.g., curly quotes, composed accents)
        s = s.normalize('NFKC');
    } catch { }
    return s
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
        .replace(/\u00A0/g, ' ')              // NBSP -> space
        .trim()
        .toLowerCase()
        .replace(/^the\s+/i, '')              // Remove leading "The "
        .replace(/[^\p{L}\p{N}\s]/gu, '')     // Remove punctuation (keep letters/numbers)
        .replace(/\s+/g, ' ');                // Collapse spaces
};

export const canonicalType = (t?: string) => {
    const norm = (t || '').trim().toLowerCase();
    if (!norm) return '';
    if (['film', 'movie', 'film series'].includes(norm) || norm.startsWith('film ')) return 'movie';
    if (norm === 'tv show' || norm === 'tv series' || norm === 'television series') return 'tv';
    // Collapse most "work-like" composites into a single bucket to avoid dupes like
    // play/film/book adaptations returning as separate nodes with the same title.
    if ([
        'work',
        'event', // keep explicit Event as-is (handled by return norm)
        'book', 'novel', 'short story', 'story', 'essay',
        'play', 'theatre', 'theater', 'musical',
        'movie', 'tv', 'episode', 'series',
        'song', 'track', 'album', 'record', 'single',
        'painting', 'artwork', 'sculpture', 'photograph',
        'opera', 'ballet', 'symphony', 'concerto', 'composition', 'piece'
    ].includes(norm)) {
        // If it's literally 'event', keep it distinct. Otherwise bucket as 'work'.
        return norm === 'event' ? 'event' : 'work';
    }
    return norm;
};

export const dedupeKey = (title: string, type?: string, wikipediaId?: string | null) => {
    const normType = canonicalType(type);
    // Always use normalized title for case-insensitive deduplication
    // If wikipedia_id exists, include it as additional info, but still dedupe by normalized title
    const normTitle = normalizeForDedup(title);
    if (wikipediaId) return `wiki|${wikipediaId}|${normTitle}|${normType}`;
    return `${normTitle}|${normType}`;
};

// Helper to get base dedupe key.
// Key insight: duplicates often happen when type metadata is missing/inconsistent on Atomics.
// To avoid duplicates like "Euclid" appearing twice, we dedupe Atomics by title only (within the Atomic partition),
// and Composites by title+type (to avoid merging distinct things that share a title).
export const baseDedupeKey = (node: { title: string; type?: string; is_atomic?: boolean; is_person?: boolean }) => {
    const normTitle = normalizeForDedup(node.title);
    const isAtomic =
        node.is_atomic ??
        node.is_person ??
        ((node.type || '').trim().toLowerCase() === 'person');
    if (isAtomic) return `a|${normTitle}`;
    const normType = canonicalType(node.type);
    // If type is missing, dedupe by title only (we'll merge any typed variant into this bucket).
    // This avoids duplicates like identical works where one node has type metadata and the other doesn't.
    if (!normType) return `c|${normTitle}`;
    return `c|${normTitle}|${normType}`;
};

// Merge duplicate nodes (same normalized title/type) and remap links accordingly.
export const dedupeGraph = (
    nodes: GraphNode[],
    links: GraphLink[]
): { nodes: GraphNode[]; links: GraphLink[] } => {
    // Use base key (normalized title + type) for deduplication, regardless of wikipedia_id
    const dedupMap = new Map<string, GraphNode>();
    const idRemap = new Map<number, number>();

    const normalizeType = (t?: string) => {
        return (t || '').trim().toLowerCase();
    };

    const mergeType = (a?: string, b?: string) => {
        const na = normalizeType(a);
        const nb = normalizeType(b);
        if (na === 'person') return a;
        if (nb === 'person') return b;
        return a || b;
    };

    const mergeNode = (existing: GraphNode, incoming: GraphNode): GraphNode => {
        // Prefer node with wikipedia_id for base properties (title, wikipedia_id)
        const prefer = existing.wikipedia_id ? existing : incoming;
        return {
            ...prefer,
            type: mergeType(existing.type, incoming.type),
            imageUrl: existing.imageUrl || incoming.imageUrl || undefined,
            imageChecked: existing.imageChecked || incoming.imageChecked || !!existing.imageUrl || !!incoming.imageUrl,
            wikiSummary: existing.wikiSummary || incoming.wikiSummary || undefined,
            description: (existing.description && existing.description.length >= (incoming.description || '').length)
                ? existing.description
                : incoming.description,
            year: existing.year ?? incoming.year,
            expanded: existing.expanded || incoming.expanded,
            isLoading: existing.isLoading || incoming.isLoading,
            // Keep wikipedia_id from whichever node has it (already in prefer spread, but explicit for clarity)
            wikipedia_id: existing.wikipedia_id || incoming.wikipedia_id || undefined
        };
    };

    nodes.forEach(n => {
        // Use a partition-aware key for case-insensitive deduplication
        const key = baseDedupeKey(n as any);
        // For composites, if we have a typed key but there's already a type-missing bucket for the same title,
        // merge into that bucket so "missing type" acts like a wildcard.
        let existing = dedupMap.get(key);
        let targetKey = key;
        if (!existing && key.startsWith('c|') && key.split('|').length === 3) {
            const titleOnlyKey = key.split('|').slice(0, 2).join('|'); // "c|<title>"
            const wildcard = dedupMap.get(titleOnlyKey);
            if (wildcard) {
                existing = wildcard;
                targetKey = titleOnlyKey;
            }
        }
        if (!existing) {
            dedupMap.set(key, n);
            idRemap.set(n.id, n.id);
        } else {
            const merged = mergeNode(existing, n);
            dedupMap.set(targetKey, merged);
            idRemap.set(n.id, merged.id);
            idRemap.set(existing.id, merged.id);
        }
    });

    const nodesOut = Array.from(dedupMap.values());

    const remapId = (value: number | GraphNode) => {
        const id = typeof value === 'number' ? value : value.id;
        return idRemap.get(id) ?? id;
    };

    const linkSeen = new Set<string>();
    const linksOut: GraphLink[] = [];
    links.forEach(l => {
        const s = remapId(l.source);
        const t = remapId(l.target);
        if (s === t) return; // drop self-links after remap
        const lid = `${s}-${t}`;
        if (linkSeen.has(lid)) return;
        linkSeen.add(lid);
        linksOut.push({
            ...l,
            source: s,
            target: t,
            id: lid
        });
    });

    return { nodes: nodesOut, links: linksOut };
};
