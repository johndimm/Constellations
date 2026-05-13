"use client";
import { GraphNode, GraphLink } from './types';
import { LockedPair } from './services/geminiService';
import { dedupeGraph } from './services/graphUtils';

const getLinkEndpointId = (x: string | number | GraphNode) =>
    typeof x === 'object' && x != null && 'id' in x ? (x as GraphNode).id : (x as string | number);

export const SOUNDINGS_CONSTELLATIONS_HANDOFF_KEY = 'soundings-constellations-handoff-v1';

export type ConstellationsSessionHandoffV1 = {
    v: 1;
    graph: { nodes: GraphNode[]; links: GraphLink[] };
    exploreTerm: string;
    pathStart: string;
    pathEnd: string;
    searchMode: 'explore' | 'connect';
    isCompact: boolean;
    isTimelineMode: boolean;
    isTextOnly: boolean;
    searchId: number;
    lockedPair: LockedPair;
    pathNodeIds: (string | number)[];
    selectedNodeId?: string | number | null;
};

export function buildHandoffFromLiveState(params: {
    graph: { nodes: GraphNode[]; links: GraphLink[] };
    exploreTerm: string;
    pathStart: string;
    pathEnd: string;
    searchMode: 'explore' | 'connect';
    isCompact: boolean;
    isTimelineMode: boolean;
    isTextOnly: boolean;
    searchId: number;
    lockedPair: LockedPair;
    pathNodeIds: (string | number)[];
    selectedNodeId: string | number | null | undefined;
}): ConstellationsSessionHandoffV1 {
    if (!params.graph.nodes.length) {
        throw new Error('Handoff requires at least one node');
    }
    const links: GraphLink[] = params.graph.links.map((l) => ({
        ...l,
        source: getLinkEndpointId(l.source as string | number | GraphNode),
        target: getLinkEndpointId(l.target as string | number | GraphNode)
    }));
    const nodes: GraphNode[] = params.graph.nodes.map((n) => ({
        ...n,
        isLoading: false,
        fetchingImage: false,
        vx: n.vx ?? 0,
        vy: n.vy ?? 0
    }));
    return {
        v: 1,
        graph: { nodes, links },
        exploreTerm: params.exploreTerm,
        pathStart: params.pathStart,
        pathEnd: params.pathEnd,
        searchMode: params.searchMode,
        isCompact: params.isCompact,
        isTimelineMode: params.isTimelineMode,
        isTextOnly: params.isTextOnly,
        searchId: params.searchId,
        lockedPair: { ...params.lockedPair },
        pathNodeIds: [...params.pathNodeIds],
        selectedNodeId: params.selectedNodeId ?? null
    };
}

/**
 * Strips simulation cruft, dedupes, and returns graph safe to put in React state.
 */
export function graphFromHandoff(h: ConstellationsSessionHandoffV1) {
    const links = h.graph.links.map((l) => ({
        ...l,
        source: getLinkEndpointId(l.source as string | number | GraphNode),
        target: getLinkEndpointId(l.target as string | number | GraphNode)
    }));
    const nodes = h.graph.nodes.map((n) => ({
        ...n,
        isLoading: false,
        fetchingImage: false,
        vx: n.vx ?? 0,
        vy: n.vy ?? 0,
        fx: n.fx ?? null,
        fy: n.fy ?? null
    }));
    return dedupeGraph(nodes, links);
}

const UNREAD: unique symbol = Symbol('embed-handoff');

/**
 * Staging from player embed: sessionStorage (once) + in-memory (duplicate React 18
 * useState initializers in StrictMode must see the same object).
 */
let embedHandoffMem: ConstellationsSessionHandoffV1 | null | typeof UNREAD = UNREAD;

/**
 * For use in `useState(() => takeEmbedHandoffForInitialState())` — no side effects
 * that differ between double invocations: second call must return the same value.
 * Always prefer a fresh `sessionStorage` payload (new navigation) over the cache.
 */
export function takeEmbedHandoffForInitialState(): ConstellationsSessionHandoffV1 | null {
    if (typeof window !== 'undefined') {
        const raw = sessionStorage.getItem(SOUNDINGS_CONSTELLATIONS_HANDOFF_KEY);
        if (raw) {
            try {
                const p = JSON.parse(raw) as ConstellationsSessionHandoffV1;
                if (p?.v === 1 && p.graph?.nodes?.length) {
                    try {
                        sessionStorage.removeItem(SOUNDINGS_CONSTELLATIONS_HANDOFF_KEY);
                    } catch { /* empty */ }
                    embedHandoffMem = p;
                    return p;
                }
            } catch { /* empty */ }
        }
    }
    if (embedHandoffMem !== UNREAD) {
        return embedHandoffMem;
    }
    if (typeof window === 'undefined') {
        embedHandoffMem = null;
        return null;
    }
    embedHandoffMem = null;
    return null;
}
