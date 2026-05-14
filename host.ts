"use client";

/**
 * Single import surface for full-page constellations inside Next hosts (Soundings, Trailer, …).
 * — `FullPageConstellations` (layout + App wiring)
 * — `useFullPageConstellationsHost` (URL + optional player bridge)
 * — `newChannelFromGraphNode` (sessionStorage + navigate)
 * — `FullPageConstellationsHostLoading`
 */
export { default as App } from "./App";
export { FullPageConstellations } from "./FullPageConstellations";
export type { FullPageConstellationsProps } from "./FullPageConstellations";
export { useFullPageConstellationsHost } from "./useFullPageConstellationsHost";
export type { NowPlayingSnapshot } from "./useFullPageConstellationsHost";
export { FullPageConstellationsHostLoading } from "./FullPageConstellationsHostShell";
export { newChannelFromGraphNode } from "./utils/graphNodeToChannelNotes";
