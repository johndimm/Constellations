import React, { useState, useEffect, useRef } from 'react';
import { GraphNode } from '../types';
import { X, ExternalLink } from 'lucide-react';

interface SidebarProps {
  selectedNode: GraphNode | null;
  onClose: () => void;
  externalToggleSignal?: number;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, onClose, externalToggleSignal }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showFullSummary, setShowFullSummary] = useState(false);
  const userManuallyCollapsedRef = useRef(false);
  const lastToggleSignalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
  const isPerson = selectedNode.is_person ?? selectedNode.type.toLowerCase() === 'person';

  // Unified side panel styling - slides right on both mobile and desktop
  const panelClasses = `fixed top-16 right-3 sm:right-4 z-50 transition-transform duration-300 ease-in-out ${isMobile ? 'w-[calc(100vw-1.5rem)] max-w-[24rem]' : 'w-[24rem]'
    } ${isCollapsed ? 'translate-x-[calc(100%+2rem)]' : 'translate-x-0'}`;

  return (
    <>
      <div className={panelClasses}>
        <div className="bg-slate-900/95 backdrop-blur-xl rounded-xl border border-slate-700 shadow-2xl relative pointer-events-auto flex flex-col p-6 max-h-[calc(100vh-2rem)] overflow-visible">

          <div className="flex-1 overflow-visible">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-white leading-tight">{selectedNode.title}</h2>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
              {/* Display type for events only (not for persons) */}
              {!isPerson && selectedNode.type && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Type</span>
                  <p className="text-blue-400 font-medium">{selectedNode.type}</p>
                </div>
              )}

              {selectedNode.description && (
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
                  className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg font-medium transition-colors text-sm mb-4"
                >
                  <ExternalLink size={16} />
                  <span>Read on Wikipedia</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
