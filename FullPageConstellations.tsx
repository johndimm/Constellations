"use client";
import { lazy, Suspense, type ComponentProps, type FC, type ReactNode } from "react";

const App = lazy(() => import("./App"));

type AppProps = ComponentProps<typeof App>;

/**
 * One code path for "full page" constellations inside a host (Soundings, Trailer Vision, etc.):
 * always `embedded` (ResizeObserver, handoff window hook) + full control panel + details sidebar
 * unless the host overrides. The in-app `AppHeader` (panel toggles, title, close) is shown by default;
 * set `hideHeader` when the host already supplies equivalent chrome.
 */
export type FullPageConstellationsProps = Omit<AppProps, "embedded" | "useViewportForPanels"> & {
  /**
   * - `fixed-overlay` — e.g. Soundings: full-viewport layer above the app (`z-[100]`).
   * - `below-app-chrome` — e.g. Trailer: fills the route shell below the site nav; parent must
   *   supply height (e.g. `h-[calc(100dvh-2.75rem)]`).
   */
  layout: "fixed-overlay" | "below-app-chrome";
  /** Wrapped around the constellations root; use for a host nav link row, etc. */
  chromeSlot?: ReactNode;
};

const defaults = {
  hideControlPanel: false,
  hideSidebar: false,
  showExtensionWhenPanelHidden: true,
  hostNavOffsetPx: 0,
} as const;

export const FullPageConstellations: FC<FullPageConstellationsProps> = ({
  layout,
  chromeSlot,
  hideHeader = false,
  hideControlPanel = defaults.hideControlPanel,
  hideSidebar = defaults.hideSidebar,
  showExtensionWhenPanelHidden = defaults.showExtensionWhenPanelHidden,
  hostNavOffsetPx = defaults.hostNavOffsetPx,
  ...rest
}) => {
  const app = (
    <Suspense fallback={null}>
      <App
        {...rest}
        embedded
        hideHeader={hideHeader}
        useViewportForPanels={layout === "fixed-overlay"}
        hideControlPanel={hideControlPanel}
        hideSidebar={hideSidebar}
        showExtensionWhenPanelHidden={showExtensionWhenPanelHidden}
        hostNavOffsetPx={hostNavOffsetPx}
      />
    </Suspense>
  );

  if (layout === "fixed-overlay") {
    return (
      <div className="fixed inset-0 z-[100] min-h-0 flex flex-col">
        {chromeSlot}
        <div className="min-h-0 min-w-0 flex-1">
          <div className="h-full min-h-0 w-full min-w-0">{app}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {chromeSlot}
      <div className="min-h-0 min-w-0 flex-1">
        <div className="h-full min-h-0 w-full min-w-0">{app}</div>
      </div>
    </div>
  );
};
