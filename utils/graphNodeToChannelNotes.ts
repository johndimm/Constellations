"use client";
import type { GraphNode } from '../types';
import { buildWikiUrl } from './wikiUtils';

const DEFAULT_NAME_MAX = 40;

/**
 * Short tab label for a channel (distinct from the long notes / DJ prompt).
 * Safe for Wikipedia-style titles; truncates with an ellipsis when needed.
 */
export function graphNodeToChannelName(node: GraphNode, maxLen = DEFAULT_NAME_MAX): string {
    const year = node.year;
    const raw = (node.title || 'Channel').replace(/\s+/g, ' ').trim() || 'Channel';
    const withYear = year != null ? `${raw} (${year})` : raw;
    const primary = withYear.length <= maxLen ? withYear : raw;
    if (primary.length <= maxLen) return primary;
    if (maxLen < 2) return '…';
    return primary.slice(0, maxLen - 1) + '…';
}

/**
 * Free-text notes for a new Soundings channel, seeded from a graph node
 * (used with createChannelWithNotes in the player).
 */
export function graphNodeToChannelNotes(node: GraphNode): string {
    const type = (node.type || 'entity').trim();
    const year = node.year != null ? ` (${node.year})` : '';
    const titleLine = `From Constellations: ${node.title}${year}`;
    const typeLine = `Type: ${type}`;

    const parts: string[] = [titleLine, typeLine];

    if (node.wikipedia_id) {
        parts.push(`Wikipedia: ${buildWikiUrl(node.title, node.wikipedia_id)}`);
    }

    const blurb = (node.wikiSummary || node.description || '').trim();
    if (blurb) {
        parts.push('', blurb.slice(0, 2000));
    }

    return parts.join('\n');
}

/** Use this when both the short name and the long prompt are needed (e.g. Soundings channel tabs + notes). */
export function graphNodeToChannelSeeds(node: GraphNode): { name: string; notes: string } {
    return {
        name: graphNodeToChannelName(node),
        notes: graphNodeToChannelNotes(node),
    };
}

/**
 * Host apps (Soundings, Trailer) queue the same sessionStorage payload then navigate; keeps route files minimal.
 */
export function newChannelFromGraphNode(
    node: GraphNode,
    options: { sessionStorageKey: string; navigate: (path: string) => void; path: string; logLabel?: string }
) {
    const { name, notes } = graphNodeToChannelSeeds(node);
    const label = options.logLabel ?? "constellations";
    try {
        sessionStorage.setItem(
            options.sessionStorageKey,
            JSON.stringify({ v: 1, name, notes })
        );
    } catch (e) {
        console.warn(`[${label}] could not queue new channel for host`, e);
    }
    options.navigate(options.path);
}
