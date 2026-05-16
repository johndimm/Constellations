"use client";

import { useEffect, useState } from "react";

export type NowPlayingSnapshot = {
  album?: string | null;
  track?: string | null;
  artist?: string | null;
};

/** Append performer when a bare title is ambiguous (e.g. "Summertime" vs "In the Summertime"). */
function nowPlayingSearchTerm(track: string | undefined, artist: string | undefined): string {
  const t = (track ?? "").trim();
  const a = (artist ?? "").trim();
  if (!t) return a;
  if (!a) return t;
  if (t.toLowerCase().includes(a.toLowerCase())) return t;
  // Classical / rich titles already name the composer; YouTube channel is often junk.
  if (/[:(~]/.test(t)) return t;
  if (/\([^)]+\)\s*$/.test(t)) return t;
  return `${t} (${a})`;
}

/**
 * State sync for every full-page constellations host (Soundings, Trailer, etc.): URL `q` / `expand`,
 * optional handoff gating, and optional live player bridge (now-playing + external search).
 * Single implementation — host apps only supply layout-specific inputs.
 */
export function useFullPageConstellationsHost(input: {
  qParam: string;
  expandParam: string;
  /** When a session handoff is present, do not clobber from URL/bridge. */
  skipUrlAndPlayerBridge: boolean;
  /**
   * If set, merge `expand` with album/track for auto-expand and drive `nowPlayingKey` /
   * `externalSearch` from the snapshot. Omit (Trailer) for URL `expand` only.
   */
  getPlayerSnapshot?: () => NowPlayingSnapshot | null | undefined;
  /** e.g. `soundings-now-playing` — bumps a revision so `nowPlayingKey` updates with the player. */
  nowPlayingBumperEvent?: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [npRev, setNpRev] = useState(0);
  const [externalSearch, setExternalSearch] = useState<{
    term: string;
    id: string | number;
  } | null>(null);
  const [autoExpandTitles, setAutoExpandTitles] = useState<string[]>([]);
  const [nowPlayingKey, setNowPlayingKey] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const bumper = input.nowPlayingBumperEvent;

  useEffect(() => {
    if (!bumper) return;
    const bump = () => setNpRev((n) => n + 1);
    window.addEventListener(bumper, bump);
    return () => window.removeEventListener(bumper, bump);
  }, [bumper]);

  const { qParam, expandParam, skipUrlAndPlayerBridge, getPlayerSnapshot } = input;

  useEffect(() => {
    if (!hydrated) return;
    if (skipUrlAndPlayerBridge) return;

    const extra = expandParam
      ? expandParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (!getPlayerSnapshot) {
      setExternalSearch(null);
      setNowPlayingKey(null);
      setAutoExpandTitles(extra);
      return;
    }

    const snap = getPlayerSnapshot();
    const album = snap?.album?.trim();
    const track = snap?.track?.trim();
    const artist = snap?.artist?.trim();
    const searchTerm = nowPlayingSearchTerm(track ?? "", artist ?? "");
    const mergedExpand = [
      ...extra,
      ...(album ? [album] : []),
      ...(searchTerm ? [searchTerm] : []),
      ...(track && searchTerm !== track ? [track] : []),
      ...(artist && !searchTerm.toLowerCase().includes(artist.toLowerCase()) ? [artist] : []),
    ];
    if (album || track) {
      setNowPlayingKey(`${npRev}::${album || ""}::${track || ""}::${artist || ""}`);
    } else {
      setNowPlayingKey(null);
    }
    if (qParam) {
      setExternalSearch(null);
    } else {
      const term = searchTerm || artist || "";
      if (term) {
        setExternalSearch({ term, id: `np:${term.toLowerCase()}` });
      } else {
        setExternalSearch(null);
      }
    }
    setAutoExpandTitles(mergedExpand);
  }, [
    hydrated,
    qParam,
    expandParam,
    skipUrlAndPlayerBridge,
    getPlayerSnapshot,
    npRev,
  ]);

  return {
    ready: hydrated,
    externalSearch,
    autoExpandTitles,
    nowPlayingKey,
  };
}
