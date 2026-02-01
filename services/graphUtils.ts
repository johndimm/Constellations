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

    const base = s
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
        .replace(/\u00A0/g, ' ')              // NBSP -> space
        .trim()
        .replace(/\s*\([^)]*\)$/, '')         // STRIP DISAMBIGUATIONS (e.g. "(film)")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')     // Remove punctuation (keep letters/numbers)
        .replace(/\s+/g, ' ')
        .trim();

    // Strip common articles from the entire string to handle "a" vs "the" mismatch.
    // e.g. "Interview with a Vampire" vs "Interview with the Vampire"
    const stripped = base.replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped || base;
};

export const canonicalType = (t?: string) => {
    const norm = (t || '').trim().toLowerCase();
    if (!norm) return '';
    // Unify all common creative works and events into a single bucket.
    // This handles cases where Gemini might call a movie an "Event" in one context 
    // and a "Movie/Work" in another.
    if ([
        'work', 'event', 'composite',
        'book', 'novel', 'short story', 'story', 'essay',
        'play', 'theatre', 'theater', 'musical',
        'movie', 'film', 'cinema', 'motion picture', 'film series',
        'tv', 'tv show', 'tv series', 'television series', 'episode', 'series', 'miniseries',
        'song', 'track', 'album', 'record', 'single',
        'painting', 'artwork', 'sculpture', 'photograph',
        'opera', 'ballet', 'symphony', 'concerto', 'composition', 'piece'
    ].some(v => norm === v || (norm.startsWith(v) && norm.length <= v.length + 3))) {
        return 'work';
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
export const baseDedupeKey = (node: { title: string; type?: string; is_atomic?: boolean; is_person?: boolean; wikipedia_id?: string | null }) => {
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
    const dedupMap = new Map<string, GraphNode>();
    const wikiIdMap = new Map<string, string>(); // wiki_id -> primary_node_id
    const idRemap = new Map<string, string>();

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
        const key = baseDedupeKey(n as any);
        const wikiId = n.wikipedia_id ? String(n.wikipedia_id) : null;

        let existing: GraphNode | undefined;
        let targetKey = key;

        // 1. Try to find by Wikipedia ID first (strongest match)
        if (wikiId && wikiIdMap.has(wikiId)) {
            const primaryId = wikiIdMap.get(wikiId)!;
            // Find the node in dedupMap that has this ID
            for (const [k, node] of dedupMap.entries()) {
                if (String(node.id) === primaryId) {
                    existing = node;
                    targetKey = k;
                    break;
                }
            }
        }

        // 2. Fall back to title-based lookup if no wiki_id match
        if (!existing) {
            existing = dedupMap.get(key);
            targetKey = key;

            // If no exact match, check for title-only collisions in the Composite partition.
            // This handles merging a node with a generic/missing type into a more specific one (or vice versa).
            if (!existing && key.startsWith('c|')) {
                const titleOnlyKey = key.split('|').slice(0, 2).join('|'); // "c|<title>"
                const wildcard = dedupMap.get(titleOnlyKey);
                if (wildcard) {
                    existing = wildcard;
                    targetKey = titleOnlyKey;
                } else {
                    // 2. Try to find ANY typed entry with the same title
                    // We search all keys for one that starts with our title-only key
                    for (const [k, node] of dedupMap.entries()) {
                        if (k.startsWith(titleOnlyKey + '|') || k === titleOnlyKey) {
                            existing = node;
                            targetKey = k;
                            break;
                        }
                    }
                }
            }
        }

        if (!existing) {
            dedupMap.set(key, n);
            idRemap.set(String(n.id), String(n.id));
            if (wikiId) wikiIdMap.set(wikiId, String(n.id));
        } else {
            const merged = mergeNode(existing, n);
            dedupMap.set(targetKey, merged);
            idRemap.set(String(n.id), String(merged.id));
            idRemap.set(String(existing.id), String(merged.id));
            if (merged.wikipedia_id) wikiIdMap.set(String(merged.wikipedia_id), String(merged.id));
        }
    });

    const nodesOut = Array.from(dedupMap.values());

    const remapId = (value: number | string | GraphNode) => {
        const id = String(typeof value === 'object' ? value.id : value);
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

type ExpansionTarget = GraphNode & {
    edge_label?: string | null;
    edge_meta?: any;
    evidence?: GraphLink['evidence'];
};

export const mergeExpansionGraph = (params: {
    nodes: GraphNode[];
    links: GraphLink[];
    parent: GraphNode;
    targets: ExpansionTarget[];
    seedFromParent?: boolean;
}): { nodes: GraphNode[]; links: GraphLink[] } => {
    const { nodes, links, parent, targets, seedFromParent = true } = params;
    const existingNodeIds = new Set(nodes.map(n => String(n.id)));
    const nodeMap = new Map<string, GraphNode>(nodes.map(n => [String(n.id), n]));

    const parentIsAtomic = !!(parent.is_atomic ?? parent.is_person ?? (parent.type || '').toLowerCase() === 'person');
    const expectedChildIsAtomic = !parentIsAtomic;

    // console.warn(`🔧 [mergeExpansionGraph] Parent "${parent.title}" isAtomic=${parentIsAtomic}, expected child isAtomic=${expectedChildIsAtomic}`);

    targets.forEach(t => {
        const meta = (t.meta || {}) as Record<string, any>;
        const existing = nodeMap.get(String(t.id));
        const imageUrl = meta.imageUrl ?? existing?.imageUrl ?? t.imageUrl;
        const wikiSummary = meta.wikiSummary ?? (t as any).wikiSummary ?? existing?.wikiSummary;

        // Trust the LLM's classification first, then existing node, then infer from parent
        const isAtomic =
            (typeof t.is_atomic === 'boolean' ? t.is_atomic : (typeof (t as any).is_person === 'boolean' ? (t as any).is_person : undefined)) ??
            (existing?.is_atomic ?? (existing as any)?.is_person) ??
            expectedChildIsAtomic;

        // console.warn(`🔧 [mergeExpansionGraph] Target "${t.title}": t.is_atomic=${t.is_atomic}, t.type="${t.type}", computed isAtomic=${isAtomic}`);

        const initialX = (!existing && seedFromParent && parent.x != null)
            ? parent.x + (Math.random() - 0.5) * 100
            : undefined;
        const initialY = (!existing && seedFromParent && parent.y != null)
            ? parent.y + (Math.random() - 0.5) * 100
            : undefined;

        const merged: GraphNode = {
            x: existing?.x ?? initialX,
            y: existing?.y ?? initialY,
            ...(existing || {}),
            id: t.id,
            title: t.title || existing?.title || '',
            type: t.type || existing?.type || '',
            is_atomic: isAtomic,
            wikipedia_id: t.wikipedia_id || existing?.wikipedia_id,
            description: wikiSummary || t.description || existing?.description || '',
            year: t.year ?? existing?.year,
            imageUrl,
            imageChecked: !!imageUrl || existing?.imageChecked,
            wikiSummary,
            expanded: existing?.expanded || false,
            isLoading: false
        };
        nodeMap.set(String(t.id), merged);
    });

    if (nodeMap.has(String(parent.id))) {
        nodeMap.set(String(parent.id), { ...nodeMap.get(String(parent.id))!, expanded: true, isLoading: false });
    }

    const updatedNodes = Array.from(nodeMap.values());
    const isAtomicForId = new Map<string, boolean>();
    updatedNodes.forEach(n => {
        const v = (n.is_atomic ?? (n as any).is_person);
        if (typeof v === 'boolean') isAtomicForId.set(String(n.id), v);
        else if ((n.type || '').toLowerCase() === 'person') isAtomicForId.set(String(n.id), true);
    });

    const candidateLinks: GraphLink[] = targets.map(t => ({
        source: parent.id,
        target: t.id,
        id: `${parent.id}-${t.id}`,
        label: t.edge_label || (t as any).role || undefined,
        evidence: t.evidence || t.edge_meta?.evidence || { kind: 'none' }
    }));

    // console.warn(`🔧 [mergeExpansionGraph] Created ${candidateLinks.length} candidate links`);

    const bipartiteSafeCandidates = candidateLinks.filter(l => {
        const s = String(typeof l.source === 'object' ? l.source.id : l.source);
        const t = String(typeof l.target === 'object' ? l.target.id : l.target);
        const sa = isAtomicForId.get(s);
        const ta = isAtomicForId.get(t);
        const pass = (sa === undefined || ta === undefined) || (sa !== ta);
        if (!pass) {
            // console.warn(`🔧 [mergeExpansionGraph] Link ${s}->${t} FILTERED: parent isAtomic=${sa}, child isAtomic=${ta}`);
        }
        return pass;
    });

    // console.warn(`🔧 [mergeExpansionGraph] After bipartite filter: ${bipartiteSafeCandidates.length} links`);

    const existingLinkIds = new Set(links.map(l => l.id));
    const updatedExistingLinks = links.map(l => {
        const cand = bipartiteSafeCandidates.find(c => c.id === l.id);
        if (!cand) return l;
        const merged: GraphLink = { ...l };
        if (!merged.label && cand.label) merged.label = cand.label;
        if ((!merged.evidence || merged.evidence.kind === 'none') && cand.evidence) merged.evidence = cand.evidence;
        return merged;
    });
    const newLinksToAdd = bipartiteSafeCandidates.filter(l => !existingLinkIds.has(l.id));
    const combinedLinks = [...updatedExistingLinks, ...newLinksToAdd];

    // console.warn(`🔧 [mergeExpansionGraph] Combined links: ${combinedLinks.length}`);

    const degree = new Map<string, number>();
    combinedLinks.forEach(l => {
        const s = String(typeof l.source === 'object' ? l.source.id : l.source);
        const t = String(typeof l.target === 'object' ? l.target.id : l.target);
        degree.set(s, (degree.get(s) || 0) + 1);
        degree.set(t, (degree.get(t) || 0) + 1);
    });
    const prunedNodes = updatedNodes.filter(n => {
        if (String(n.id) === String(parent.id)) return true;
        if (existingNodeIds.has(String(n.id))) return true;
        const deg = degree.get(String(n.id)) || 0;
        const keep = deg > 0;
        if (!keep && !existingNodeIds.has(String(n.id))) {
            // console.warn(`🔧 [mergeExpansionGraph] Node "${n.title}" (${n.id}) PRUNED: degree=${deg}`);
        }
        return keep;
    });

    // console.warn(`🔧 [mergeExpansionGraph] After pruning: ${prunedNodes.length} nodes from ${updatedNodes.length}`);

    return dedupeGraph(prunedNodes, combinedLinks);
};
