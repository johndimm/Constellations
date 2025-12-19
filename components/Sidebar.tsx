import React, { useState, useEffect } from 'react';
import { GraphNode } from '../types';
import { X, ExternalLink, Flag, Target, ChevronUp, ChevronDown, Plus, Loader2, Trash2 } from 'lucide-react';

interface SidebarProps {
  selectedNode: GraphNode | null;
  onClose: () => void;
  onSetStart: (id: string) => void;
  onSetEnd: (id: string) => void;
  onAddMore?: (node: GraphNode) => void;
  onRecursiveDelete?: (nodeId: string) => void;
  isProcessing?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, onClose, onSetStart, onSetEnd, onAddMore, onRecursiveDelete, isProcessing }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

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

  // Desktop Side Panel Styling
  const desktopClasses = `fixed top-4 right-4 z-20 w-[24rem] transition-transform duration-300 ease-in-out ${isCollapsed ? 'translate-x-[calc(100%+2rem)]' : 'translate-x-0'
    }`;

  // Mobile Bottom Drawer Styling
  const mobileClasses = `fixed bottom-0 left-0 right-0 z-30 transition-transform duration-300 ease-in-out ${isCollapsed ? 'translate-y-[calc(100%-3.5rem)]' : 'translate-y-0'
    }`;

  return (
    <div className={isMobile ? mobileClasses : desktopClasses}>
      <div className={`bg-slate-900/95 backdrop-blur-xl border-slate-700 shadow-2xl relative pointer-events-auto flex flex-col ${isMobile
        ? 'rounded-t-2xl border-t h-[60vh] max-h-[80%]'
        : 'rounded-xl border p-6 max-h-[calc(100vh-2rem)] overflow-y-auto'
        }`}>

        {/* Toggle Handle - Different positions for Mobile vs Desktop */}
        {!isMobile ? (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -left-12 top-0 w-10 h-10 bg-slate-900/90 border border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors shadow-xl"
            title={isCollapsed ? "Expand Details" : "Collapse Details"}
          >
            {isCollapsed ? <ChevronUp className="-rotate-90" size={20} /> : <ChevronUp className="rotate-90" size={20} />}
          </button>
        ) : (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-full flex items-center justify-center py-3 border-b border-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white truncate max-w-[200px]">{selectedNode.id}</span>
              {isCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>
        )}

        <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-5' : ''}`}>
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-bold text-white leading-tight">{selectedNode.id}</h2>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {selectedNode.expanded && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onAddMore?.(selectedNode)}
                    disabled={isProcessing}
                    className="text-slate-400 hover:text-indigo-400 transition-colors bg-slate-800 p-1.5 rounded-lg border border-slate-700 disabled:opacity-50"
                    title="Add more connections (6-8 more)"
                  >
                    {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                  </button>
                  <button
                    onClick={() => onRecursiveDelete?.(selectedNode.id)}
                    className="text-slate-400 hover:text-red-400 transition-colors bg-slate-800 p-1.5 rounded-lg border border-slate-700"
                    title="Delete this node and all its children"
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

            {/* Pathfinding Actions */}
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Connect</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onSetStart(selectedNode.id)}
                  className="flex items-center justify-center gap-2 bg-indigo-900/50 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/50 py-2 rounded-lg text-xs font-medium transition-colors"
                >
                  <Flag size={14} />
                  Set Start
                </button>
                <button
                  onClick={() => onSetEnd(selectedNode.id)}
                  className="flex items-center justify-center gap-2 bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-700/50 py-2 rounded-lg text-xs font-medium transition-colors"
                >
                  <Target size={14} />
                  Set End
                </button>
              </div>
            </div>

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
  );
};

export default Sidebar;