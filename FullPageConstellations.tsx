"use client";
import { lazy, Suspense, type ComponentProps, type FC, type ReactNode } from "react";

const App = lazy(() => import("./App"));

type AppProps = ComponentProps<typeof App>;

/**
 * Embeddable full-page constellations for host apps (Soundings, Trailer Vision, etc.).
 * Always renders in embedded mode (ResizeObserver, handoff window hook) with full chrome.
 */
export type FullPageConstellationsProps = Omit<AppProps, "embedded" | "useViewportForPanels"> & {
  /**
   * - `fixed-overlay` — full-viewport layer above the app (e.g. Soundings, `z-[100]`).
   * - `below-app-chrome` — fills route shell below site nav; parent must supply height.
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
