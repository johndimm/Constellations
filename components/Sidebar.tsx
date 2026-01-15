import React, { useState, useEffect, useRef } from 'react';
import { GraphNode, GraphLink } from '../types';
import { X, ExternalLink, Search } from 'lucide-react';

interface SidebarProps {
  selectedNode: GraphNode | null;
  selectedLink?: GraphLink | null;
  onClose: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
  externalToggleSignal?: number;
  onFindBetterImage?: (nodeId: number) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, selectedLink, onClose, onCollapseChange, externalToggleSignal, onFindBetterImage }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
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
    if (selectedNode) {
      if (!isMobile && !userManuallyCollapsedRef.current) {
        setIsCollapsed(false);
      } else {
        setIsCollapsed(true);
      }
      setShowFullSummary(false);
    }
  }, [selectedNode, isMobile]);

  // External toggle (from header button)
  useEffect(() => {
    if (externalToggleSignal === undefined) return;
    if (lastToggleSignalRef.current === undefined) {
      lastToggleSignalRef.current = externalToggleSignal;
      return;
    }
    if (externalToggleSignal !== lastToggleSignalRef.current) {
      lastToggleSignalRef.current = externalToggleSignal;
      handleToggleCollapse();
    }
  }, [externalToggleSignal]);

  const handleToggleCollapse = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    // Track that user manually collapsed it
    userManuallyCollapsedRef.current = newCollapsed;
  };

  if (!selectedNode) return null;

  const nonPersonTypes = ['Movie', 'Event', 'Battle', 'Project', 'Company', 'Organization', 'Album', 'Song', 'Book', 'War', 'Treaty', 'Administration'];
  const isPerson = selectedNode.is_atomic ?? selectedNode.is_person ?? selectedNode.type.toLowerCase() === 'person';

  // Unified side panel styling - slides right on both mobile and desktop
  const panelClasses = `fixed top-16 right-3 sm:right-4 z-50 transition-transform duration-300 ease-in-out ${isCollapsed ? 'translate-x-[calc(100%+2rem)]' : 'translate-x-0'}`;
  const panelStyle = isMobile
    ? { width: 'calc(100% - 1.5rem)', maxWidth: '24rem' }
    : { width: '24rem' };

  return (
    <>
      <div className={panelClasses} style={panelStyle}>
        <div className="bg-slate-900/95 backdrop-blur-xl rounded-xl border border-slate-700 shadow-2xl relative pointer-events-auto flex flex-col p-6 max-h-[calc(100vh-2rem)] overflow-visible">

          <div className="flex-1 overflow-visible">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-white leading-tight">{selectedNode.title}</h2>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
              {/* Selected Edge Evidence (when user clicks an edge) */}
              {selectedLink?.evidence && selectedLink.evidence.kind !== 'none' && (
                <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-600/40">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      Edge Evidence
                    </span>
                    {selectedLink.evidence.url && (
                      <a
                        href={selectedLink.evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-amber-300 hover:text-amber-200"
                      >
                        Open Source
                      </a>
                    )}
                  </div>
                  {selectedLink.evidence.pageTitle && (
                    <div className="text-xs font-semibold text-slate-200 mb-2">
                      From: {selectedLink.evidence.pageTitle}
                    </div>
                  )}
                  {selectedLink.evidence.snippet && (
                    <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">
                      “{selectedLink.evidence.snippet}”
                    </p>
                  )}
                </div>
              )}

              {/* AI Classification Info */}
              {(selectedNode.atomic_type || selectedNode.composite_type) && (
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
              {!isPerson && selectedNode.type && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Type</span>
                  <p className="text-blue-400 font-medium">{selectedNode.type}</p>
                </div>
              )}

              {selectedNode.description && !isRedundant(selectedNode.description, selectedNode.wikiSummary) && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Description</span>
                  <p className="text-slate-300 text-sm leading-relaxed mt-1 whitespace-pre-wrap">{selectedNode.description}</p>
                </div>
              )}

              {selectedNode.wikiSummary && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Wikipedia Summary</span>
                  <p className="text-slate-200 text-sm leading-relaxed mt-1 whitespace-pre-wrap">
                    {showFullSummary || selectedNode.wikiSummary.length <= 600
                      ? selectedNode.wikiSummary
                      : `${selectedNode.wikiSummary.slice(0, 600)}…`}
                  </p>
                  {selectedNode.wikiSummary.length > 600 && (
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
              <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
                <a
                  href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(selectedNode.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg font-medium transition-colors text-sm"
                >
                  <ExternalLink size={16} />
                  <span>Read on Wikipedia</span>
                </a>
                
                {onFindBetterImage && (
                  <button
                    onClick={() => onFindBetterImage(selectedNode.id)}
                    disabled={selectedNode.fetchingImage}
                    className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg font-medium transition-colors text-sm mb-4 disabled:opacity-50"
                  >
                    <Search size={16} />
                    <span>{selectedNode.fetchingImage ? 'Finding...' : 'Find better photo'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
