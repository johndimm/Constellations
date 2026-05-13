"use client";

import type { ReactNode } from "react";

const loadingBase =
  "flex items-center justify-center bg-slate-950 text-sm text-slate-200";

/**
 * One loading shell for all full-page constellations routes (see `useFullPageConstellationsHost`).
 */
export function FullPageConstellationsHostLoading({
  surface,
  children = "Loading…",
}: {
  /** `in-layout` = under a site nav; `overlay` = full-viewport cover (e.g. Soundings) */
  surface: "in-layout" | "overlay";
  children?: ReactNode;
}) {
  if (surface === "overlay") {
    return (
      <div className={`min-h-screen ${loadingBase}`}>{children}</div>
    );
  }
  return (
    <div className={`flex h-full min-h-0 w-full ${loadingBase}`}>{children}</div>
  );
}
