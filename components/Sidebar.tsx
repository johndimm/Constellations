"use client";
import React, { useState, useEffect, useRef } from 'react';
import { GraphNode, GraphLink } from '../types';
import { X, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildWikiUrl } from '../utils/wikiUtils';

interface SidebarProps {
  selectedNode: GraphNode | null;
  selectedLink?: GraphLink | null;
  onClose: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
  externalToggleSignal?: number;
  isAdminMode?: boolean;
  forceExpanded?: boolean;
  /**
   * Top offset: with `useAbsoluteLayout`, this is from the constellations `main` (use `top-14`).
   * With `position: fixed`, use viewport space (e.g. `top-14` standalone or `top-[6.25rem]` over a host).
   */
  offsetTopClass?: string;
  /**
   * When true (e.g. embedded in Trailer), use `position: absolute` in the constellations root so
   * the panel is not `fixed` to the wrong viewport/clip. Must match the control bar (`top-14` in `main`).
   */
  useAbsoluteLayout?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, selectedLink, onClose, onCollapseChange, externalToggleSignal, isAdminMode, forceExpanded, offsetTopClass = "top-14", useAbsoluteLayout = false }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  const [showFullSummary, setShowFullSummary] = useState(false);
  const userManuallyCollapsedRef = useRef(false);
  const lastToggleSignalRef = useRef<number | undefined>(undefined);

  const isRedundant = (s1?: string, s2?: string) => {
    if (!s1 || !s2) return false;
    const clean = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const c1 = clean(s1);
    const c2 = clean(s2);
    if (c1 === c2) return true;
    if (c1.length > 10 && c2.includes(c1)) return true;
    if (c2.length > 10 && c1.includes(c2)) return true;
    return false;
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (onCollapseChange) {
      onCollapseChange(isCollapsed);
    }
  }, [isCollapsed, onCollapseChange]);

  // Auto-expand logic: Only auto-expand on desktop if user hasn't manually collapsed it
  // On mobile, keep it collapsed so it doesn't block the graph.
  useEffect(() => {
    if (!selectedNode && !selectedLink) return;
    if (forceExpanded) {
      setIsCollapsed(false);
      setShowFullSummary(false);
      return;
    }
    if (!isMobile && !userManuallyCollapsedRef.current) {
      setIsCollapsed(false);
    } else {
      setIsCollapsed(true);
    }
    setShowFullSummary(false);
  }, [selectedNode, selectedLink, isMobile, forceExpanded]);

  // External toggle (from header) — use functional setState (effect must not call a stale handler)
  useEffect(() => {
    if (externalToggleSignal === undefined) return;
    if (lastToggleSignalRef.current === undefined) {
      lastToggleSignalRef.current = externalToggleSignal;
      return;
    }
    if (externalToggleSignal !== lastToggleSignalRef.current) {
      lastToggleSignalRef.current = externalToggleSignal;
      setIsCollapsed((c) => {
        const next = !c;
        userManuallyCollapsedRef.current = next;
        return next;
      });
    }
  }, [externalToggleSignal]);

  const handleToggleCollapse = () => {
    setIsCollapsed((c) => {
      const next = !c;
      userManuallyCollapsedRef.current = next;
      return next;
    });
  };

  if (!selectedNode && !selectedLink) return null;

  const nonPersonTypes = ['Movie', 'Event', 'Battle', 'Project', 'Company', 'Organization', 'Album', 'Song', 'Book', 'War', 'Treaty', 'Administration'];
  const isPerson = selectedNode ? (selectedNode.is_atomic === true || selectedNode.is_person === true || (selectedNode.type.toLowerCase() === 'person' || selectedNode.type.toLowerCase() === 'actor')) : false;

  // Unified side panel styling - slides right on both mobile and desktop
  // When embedded, `absolute` + same `top` as control bar avoids `fixed` viewport/clip bugs in hosts.
  const effectiveMobile = forceExpanded ? false : isMobile;
  const panelWidth = effectiveMobile
    ? useAbsoluteLayout
      ? "calc(100% - 1.5rem)"
      : "calc(100vw - 1.5rem)"
    : "26rem";
  const pos = useAbsoluteLayout ? "absolute" : "fixed";
  const panelClasses = `${pos} bottom-0 right-0 z-[55] transition-transform duration-300 ease-in-out ${isCollapsed ? "translate-x-[calc(100%-24px)]" : "translate-x-0"} ${offsetTopClass}`;
  const panelStyle: React.CSSProperties = {
    width: panelWidth,
    maxWidth: "28rem",
    paddingRight: effectiveMobile ? "0.75rem" : "1rem",
  };

  return (
    <>
      <div className={panelClasses} style={panelStyle}>
        <div className="bg-slate-900/95 backdrop-blur-xl rounded-xl border border-slate-700 shadow-2xl relative pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden p-4 sm:p-6">
          {/* Persistent Toggle Handle */}
          <button
            type="button"
            onClick={handleToggleCollapse}
            className={`absolute top-1/2 -translate-y-1/2 -left-8 w-8 h-24 bg-slate-800 border border-slate-700 border-r-0 rounded-l-xl flex flex-col items-center justify-center text-slate-400 hover:text-white transition-all group shadow-xl ${isCollapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            title={isCollapsed ? "Expand details panel" : "Collapse details panel"}
          >
            {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            <div className="[writing-mode:vertical-lr] text-[9px] uppercase tracking-tighter mt-1 font-bold">Details</div>
          </button>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 custom-scrollbar">
            <div className="mb-3 shrink-0">
              <h2 className="text-xl font-bold leading-tight text-white">
                {selectedNode ? selectedNode.title : "Connection Details"}
              </h2>
            </div>

            <div className="min-h-0 space-y-4 pb-1">
              {/* Selected Edge Evidence (when user clicks an edge) */}
              {selectedLink && (
                <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-600/40">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      Edge Selected
                    </span>
                    {selectedLink.evidence?.url && (
                      <a
                        href={selectedLink.evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-amber-300 hover:text-amber-200"
                      >
                        View Source
                      </a>
                    )}
                  </div>
                  {selectedLink.label && (
                    <div className="text-xs font-semibold text-slate-200 mb-2">
                      {selectedLink.label}
                    </div>
                  )}
                  {selectedLink.evidence?.pageTitle && (
                    <div className="text-xs font-semibold text-slate-200 mb-2">
                      From: {selectedLink.evidence.pageTitle}
                    </div>
                  )}
                  {selectedLink.evidence?.snippet && selectedLink.evidence.kind !== 'none' ? (
                    <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">
                      “{selectedLink.evidence.snippet}”
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      No evidence snippet available for this edge yet.
                    </p>
                  )}
                </div>
              )}

              {/* AI Classification Info (Admin only) */}
              {isAdminMode && selectedNode && (selectedNode.atomic_type || selectedNode.composite_type) && (
                <div className="p-3 bg-blue-900/20 rounded-lg border border-blue-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 px-1.5 py-0.5 bg-blue-500/10 rounded">
                      AI Classification
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-blue-200 mb-2">
                    {selectedNode.atomic_type} ↔ {selectedNode.composite_type}
                  </div>
                  {selectedNode.classification_reasoning && (
                    <p className="text-[11px] text-blue-300 italic leading-relaxed">
                      "{selectedNode.classification_reasoning}"
                    </p>
                  )}
                </div>
              )}

              {/* Display type for events only (not for persons) */}
              {selectedNode && !isPerson && selectedNode.type && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Type</span>
                    <p className="text-blue-400 font-medium">{selectedNode.type}</p>
                  </div>
                  {selectedNode.year && selectedNode.year !== 0 && (
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Date</span>
                      <p className="text-amber-400 font-medium">{selectedNode.year}</p>
                    </div>
                  )}
                </div>
              )}

              {selectedNode && isPerson && selectedNode.year && selectedNode.year !== 0 && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Around</span>
                  <p className="text-amber-400 font-medium">{selectedNode.year}</p>
                </div>
              )}

              {selectedNode && selectedNode.description && !isRedundant(selectedNode.description, selectedNode.wikiSummary) && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Description</span>
                  <p className="text-slate-300 text-sm leading-relaxed mt-1 whitespace-pre-wrap">{selectedNode.description}</p>
                </div>
              )}

              {selectedNode && selectedNode.wikiSummary && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Wikipedia Summary</span>
                  <p className="text-slate-200 text-sm leading-relaxed mt-1 whitespace-pre-wrap">
                    {showFullSummary || (selectedNode.wikiSummary || '').length <= 600
                      ? selectedNode.wikiSummary
                      : `${(selectedNode.wikiSummary || '').slice(0, 600)}…`}
                  </p>
                  {selectedNode.wikiSummary && selectedNode.wikiSummary.length > 600 && (
                    <button
                      onClick={() => setShowFullSummary(!showFullSummary)}
                      className="mt-1 text-xs text-amber-300 hover:text-amber-200"
                    >
                      {showFullSummary ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              )}


              {/* Action Buttons */}
              {selectedNode && (
                <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
                  {(selectedNode as any)?.meta?.openAlexUrl && (
                    <a
                      href={(selectedNode as any).meta.openAlexUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg font-medium transition-colors text-sm"
                    >
                      <ExternalLink size={16} />
                      <span>View on OpenAlex</span>
                    </a>
                  )}
                  {(selectedNode as any)?.meta?.doi && (
                    <a
                      href={`https://doi.org/${String((selectedNode as any).meta.doi).replace(/^https?:\/\/doi\.org\//i, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg font-medium transition-colors text-sm"
                    >
                      <ExternalLink size={16} />
                      <span>View DOI</span>
                    </a>
                  )}
                  <a
                    href={buildWikiUrl(selectedNode.title, selectedNode.wikipedia_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg font-medium transition-colors text-sm"
                  >
                    <ExternalLink size={16} />
                    <span>Read on Wikipedia</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
