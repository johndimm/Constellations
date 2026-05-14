"use client";
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

const linkEndpointsRaw = (l: GraphLink) => {
    const get = (e: string | number | GraphNode) => {
        if (e != null && typeof e === "object" && "id" in (e as object)) return String((e as GraphNode).id);
        return String(e);
    };
    return { a: get(l.source), b: get(l.target) };
};

/**
 * Re-attach work/composite nodes that have no edges (often from bipartite filtering or
 * id-remap glitches) to the most connected person in the session — typical discography layout.
 * Safe for small exploration graphs; conservative gates avoid cross-topic path searches.
 */
export const spliceOrphanCompositesToPersonHub = (
    nodes: GraphNode[],
    links: GraphLink[]
): { nodes: GraphNode[]; links: GraphLink[] } => {
    if (nodes.length < 2) return { nodes, links };

    const pairKey = (x: string, y: string) => (x < y ? `${x}↔${y}` : `${y}↔${x}`);

    const isPerson = (n: GraphNode) => {
        const t = (n.type || "").toLowerCase();
        if (t === "person" || t === "actor" || t === "author" || t === "musician" || t === "singer") return true;
        if ((n as { is_person?: boolean }).is_person) return true;
        if (n.is_atomic === true) {
            if (["album", "film", "movie", "song", "record", "book", "single", "track", "opera", "play"].some((w) => t.includes(w))) {
                return false;
            }
            return true;
        }
        return false;
    };

    const degree = new Map<string, number>();
    const existingPairs = new Set<string>();
    for (const l of links) {
        const { a, b } = linkEndpointsRaw(l);
        if (!a || !b || a === b || a === "undefined" || b === "undefined") continue;
        existingPairs.add(pairKey(a, b));
        degree.set(a, (degree.get(a) || 0) + 1);
        degree.set(b, (degree.get(b) || 0) + 1);
    }

    const personHubs = nodes.filter((n) => isPerson(n) && (degree.get(String(n.id)) || 0) > 0);
    if (personHubs.length === 0) return { nodes, links };
    personHubs.sort(
        (x, y) => (degree.get(String(y.id)) || 0) - (degree.get(String(x.id)) || 0)
    );
    if (personHubs.length >= 2) {
        const d0 = degree.get(String(personHubs[0].id)) || 0;
        const d1 = degree.get(String(personHubs[1].id)) || 0;
        if (d0 === d1) return { nodes, links };
    }
    const hub = personHubs[0];
    const hubDeg = degree.get(String(hub.id)) || 0;
    if (hubDeg < 2) return { nodes, links };

    const orphans = nodes.filter((n) => {
        if (isPerson(n)) return false;
        return (degree.get(String(n.id)) || 0) === 0;
    });
    if (orphans.length === 0) return { nodes, links };
    if (orphans.length > 24) return { nodes, links };

    const added: GraphLink[] = [];
    for (const o of orphans) {
        if (String(o.id) === String(hub.id)) continue;
        const a = String(hub.id);
        const b = String(o.id);
        const pk = pairKey(a, b);
        if (existingPairs.has(pk)) continue;
        existingPairs.add(pk);
        added.push({
            id: `inferred-${a}-${b}`,
            source: hub.id,
            target: o.id,
            evidence: { kind: "none" as const }
        });
    }
    if (added.length === 0) return { nodes, links };
    return { nodes, links: [...links, ...added] };
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
            type: mergeType(existing.type, incoming.type) || existing.type || incoming.type || 'Node',
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

    const remapId = (value: number | string | GraphNode | null | undefined) => {
        const raw =
            value != null && typeof value === 'object' && 'id' in (value as object)
                ? (value as GraphNode).id
                : (value as number | string);
        const id = String(raw);
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

    // Drop links whose endpoints are not in the deduped node set (stale ids after merge/prune).
    // Graph.tsx only draws validLinks when both ends exist; ghost edges must not pollute state.
    const nodeIdSet = new Set(nodesOut.map((n) => String(n.id)));
    const linksFiltered = linksOut.filter((l) => {
        const a = String(l.source);
        const b = String(l.target);
        return nodeIdSet.has(a) && nodeIdSet.has(b);
    });

    const spliced = spliceOrphanCompositesToPersonHub(nodesOut, linksFiltered);

    // Final pass: remove any nodes that are still isolated (degree 0) after splice.
    // These arise when dedup ID remapping drops links, leaving both composite and atomic orphans.
    // Only prune when there are multiple nodes — a single-node graph (e.g. search just started)
    // must be preserved.
    if (spliced.nodes.length > 1) {
        const finalDegree = new Map<string, number>();
        spliced.links.forEach(l => {
            const s = String(typeof l.source === 'object' ? (l.source as any).id : l.source);
            const t = String(typeof l.target === 'object' ? (l.target as any).id : l.target);
            finalDegree.set(s, (finalDegree.get(s) || 0) + 1);
            finalDegree.set(t, (finalDegree.get(t) || 0) + 1);
        });
        const connected = spliced.nodes.filter(n => (finalDegree.get(String(n.id)) || 0) > 0);
        if (connected.length > 0) {
            return { nodes: connected, links: spliced.links };
        }
    }

    return spliced;
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

    const parentId = String(parent.id);
    const bipartiteSafeCandidates = candidateLinks.filter(l => {
        const s = String(typeof l.source === 'object' ? l.source.id : l.source);
        const t = String(typeof l.target === 'object' ? l.target.id : l.target);
        // Expansion edges always go from this parent; trust them even if is_atomic is noisy.
        if (s === parentId) return true;
        const sa = isAtomicForId.get(s);
        const ta = isAtomicForId.get(t);
        return (sa === undefined || ta === undefined) || (sa !== ta);
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
        const deg = degree.get(String(n.id)) || 0;
        // Do NOT keep "existing" graph nodes with no edges — that leaves floating islands.
        return deg > 0;
    });

    // console.warn(`🔧 [mergeExpansionGraph] After pruning: ${prunedNodes.length} nodes from ${updatedNodes.length}`);

    return dedupeGraph(prunedNodes, combinedLinks);
};
