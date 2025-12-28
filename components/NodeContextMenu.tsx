import React from 'react';
import { GraphNode } from '../types';
import { Maximize, Plus, Trash2 } from 'lucide-react';

interface NodeContextMenuProps {
    node: GraphNode;
    x: number;
    y: number;
    onExpandLeaves: (node: GraphNode) => void;
    onAddMore: (node: GraphNode) => void;
    onDelete: (nodeId: number) => void;
    onClose: () => void;
    isProcessing?: boolean;
}

const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
    node,
    x,
    y,
    onExpandLeaves,
    onAddMore,
    onDelete,
    onClose,
    isProcessing
}) => {
    const handleAction = (action: () => void) => {
        action();
        onClose();
    };

    // Calculate position to keep menu on screen
    const menuWidth = 220;
    const menuHeight = 140;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 20);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 20);

    return (
        <>
            {/* Backdrop to close menu on click outside */}
            <div
                className="fixed inset-0 z-40"
                onClick={onClose}
            />

            {/* Context Menu */}
            <div
                className="fixed z-50 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[220px]"
                style={{
                    left: `${adjustedX}px`,
                    top: `${adjustedY}px`
                }}
            >
                <button
                    onClick={() => handleAction(() => onExpandLeaves(node))}
                    disabled={isProcessing || !node.expanded}
                    className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 transition-colors"
                >
                    <Maximize size={16} className="text-emerald-400" />
                    <span>Expand Leaf Nodes</span>
                </button>

                <button
                    onClick={() => handleAction(() => onAddMore(node))}
                    disabled={isProcessing || !node.expanded}
                    className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 transition-colors"
                >
                    <Plus size={16} className="text-indigo-400" />
                    <span>Expand More</span>
                </button>

                <div className="h-px bg-slate-700 my-1" />

                <button
                    onClick={() => handleAction(() => onDelete(node.id))}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-slate-800 flex items-center gap-3 transition-colors"
                >
                    <Trash2 size={16} />
                    <span>Delete Node</span>
                </button>
            </div>
        </>
    );
};

export default NodeContextMenu;
