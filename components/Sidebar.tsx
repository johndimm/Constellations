import React, { useState, useEffect } from 'react';
import { GraphNode } from '../types';
import { X, ExternalLink, ChevronUp, Plus, Loader2, Trash2, Maximize } from 'lucide-react';

interface SidebarProps {
  selectedNode: GraphNode | null;
  onClose: () => void;
  onAddMore?: (node: GraphNode) => void;
  onExpandLeaves?: (node: GraphNode) => void;
  onSmartDelete?: (nodeId: string) => void;
  isProcessing?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, onClose, onAddMore, onExpandLeaves, onSmartDelete, isProcessing }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [activeAction, setActiveAction] = useState<'expand' | 'add' | null>(null);

  useEffect(() => {
    if (!isProcessing) {
      setActiveAction(null);
    }
  }, [isProcessing]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-expand logic: Only auto-expand on desktop. On mobile, keep it collapsed so it doesn't block the graph.
  useEffect(() => {
    if (selectedNode) {
      if (!isMobile) {
        setIsCollapsed(false);
      } else {
        setIsCollapsed(true);
      }
    }
  }, [selectedNode, isMobile]);

  if (!selectedNode) return null;

  const nonPersonTypes = ['Movie', 'Event', 'Battle', 'Project', 'Company', 'Organization', 'Album', 'Song', 'Book', 'War', 'Treaty', 'Administration'];
  const isPerson = selectedNode.type === 'Person' || !nonPersonTypes.includes(selectedNode.type);

  // Unified side panel styling - slides right on both mobile and desktop
  const panelClasses = `fixed top-4 right-4 z-20 transition-transform duration-300 ease-in-out ${isMobile ? 'w-[calc(100vw-2rem)] max-w-[24rem]' : 'w-[24rem]'
    } ${isCollapsed ? 'translate-x-[calc(100%+2rem)]' : 'translate-x-0'}`;

  return (
    <>
      {/* Toggle Handle - Positioned independently to stay visible */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`fixed top-4 z-30 w-10 h-10 bg-slate-900/90 border border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-all duration-300 shadow-xl pointer-events-auto ${isCollapsed ? 'right-4' : 'right-[calc(min(24rem,100vw-2rem)+1rem)]'
          }`}
        title={isCollapsed ? "Expand Details" : "Collapse Details"}
      >
        {isCollapsed ? <ChevronUp className="-rotate-90" size={20} /> : <ChevronUp className="rotate-90" size={20} />}
      </button>

      <div className={panelClasses}>
        <div className="bg-slate-900/95 backdrop-blur-xl rounded-xl border border-slate-700 shadow-2xl relative pointer-events-auto flex flex-col p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">

          <div className="flex-1 overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-white leading-tight">{selectedNode.id}</h2>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {selectedNode.expanded && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setActiveAction('expand');
                        onExpandLeaves?.(selectedNode);
                      }}
                      disabled={isProcessing}
                      className="text-slate-400 hover:text-emerald-400 transition-colors bg-slate-800 p-1.5 rounded-lg border border-slate-700 disabled:opacity-50 flex items-center justify-center min-w-[32px] min-h-[32px]"
                      title="Expand all unexpanded neighbor nodes"
                    >
                      {isProcessing && activeAction === 'expand' ? <Loader2 size={18} className="animate-spin" /> : <Maximize size={18} />}
                    </button>
                    <button
                      onClick={() => {
                        setActiveAction('add');
                        onAddMore?.(selectedNode);
                      }}
                      disabled={isProcessing}
                      className="text-slate-400 hover:text-indigo-400 transition-colors bg-slate-800 p-1.5 rounded-lg border border-slate-700 disabled:opacity-50 flex items-center justify-center min-w-[32px] min-h-[32px]"
                      title="Add more connections (6-8 more)"
                    >
                      {isProcessing && activeAction === 'add' ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                    </button>
                    <button
                      onClick={() => onSmartDelete?.(selectedNode.id)}
                      className="text-slate-400 hover:text-red-400 transition-colors bg-slate-800 p-1.5 rounded-lg border border-slate-700"
                      title="Delete this node and prune dangling branches"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Type</span>
                <p className={`${isPerson ? 'text-amber-400' : 'text-blue-400'} font-medium`}>{selectedNode.type}</p>
              </div>

              {selectedNode.description && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Description</span>
                  <p className="text-slate-300 text-sm leading-relaxed mt-1">{selectedNode.description}</p>
                </div>
              )}


              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
                <a
                  href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(selectedNode.id)}`}
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