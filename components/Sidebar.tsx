import React from 'react';
import { GraphNode } from '../types';
import { X, ExternalLink } from 'lucide-react';

interface SidebarProps {
  selectedNode: GraphNode | null;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedNode, onClose }) => {
  if (!selectedNode) return null;

  // Broaden check for "Person" to include various roles or simply exclude known non-person types
  const nonPersonTypes = ['Movie', 'Event', 'Battle', 'Project', 'Company', 'Organization', 'Album', 'Song', 'Book', 'War', 'Treaty', 'Administration'];
  const isPerson = selectedNode.type === 'Person' || 
                   !nonPersonTypes.includes(selectedNode.type);

  return (
    <div className="absolute top-4 right-4 z-10 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-6 transition-transform animate-in slide-in-from-right">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-xl font-bold text-white leading-tight">{selectedNode.id}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
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
  );
};

export default Sidebar;