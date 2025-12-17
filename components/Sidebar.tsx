import React, { useState, useEffect } from 'react';
import { GraphNode } from '../types';
import { X, ExternalLink, Flag, Target, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  selectedNode: GraphNode | null;
  onClose: () => void;
  onSetStart: (id: string) => void;
  onSetEnd: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, onClose, onSetStart, onSetEnd }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-expand when a new node is selected
  useEffect(() => {
    if (selectedNode) {
      setIsCollapsed(false);
    }
  }, [selectedNode]);

  if (!selectedNode) return null;

  // Broaden check for "Person" to include various roles or simply exclude known non-person types
  const nonPersonTypes = ['Movie', 'Event', 'Battle', 'Project', 'Company', 'Organization', 'Album', 'Song', 'Book', 'War', 'Treaty', 'Administration'];
  const isPerson = selectedNode.type === 'Person' || 
                   !nonPersonTypes.includes(selectedNode.type);

  return (
    <div 
      className={`absolute top-4 right-4 z-20 transition-transform duration-300 ease-in-out ${
        isCollapsed ? 'translate-x-[calc(100%+1rem)]' : 'translate-x-0'
      } w-[calc(100vw-3rem)] max-w-[20rem] md:max-w-[24rem]`}
    >
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-6 relative pointer-events-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
        {/* Toggle Handle */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -left-12 top-0 w-10 h-10 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors shadow-xl"
          title={isCollapsed ? "Expand Details" : "Collapse Details"}
        >
          {isCollapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>

        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold text-white leading-tight">{selectedNode.id}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0 ml-2">
            <X size={20} />
          </button>
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
              className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg font-medium transition-colors text-sm"
             >
              <ExternalLink size={16} />
              <span>Read on Wikipedia</span>
             </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;