import React from 'react';
import { GraphNode } from '../types';
import { Maximize, Plus, Sparkles, Trash2 } from 'lucide-react';

interface NodeContextMenuProps {
    node: GraphNode;
    x: number;
    y: number;
    onExpandLeaves: (node: GraphNode) => void;
    onAddMore: (node: GraphNode) => void;
    onFindBetterPhoto: (nodeId: number) => void;
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
    onFindBetterPhoto,
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
    const menuHeight = 180;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 20);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 20);

    return (
        <>
            {/* Backdrop to close menu on click outside */}
            <div
                className="fixed inset-0 z-40"
                style={{ position: 'fixed', inset: 0, zIndex: 999998 }}
                onClick={onClose}
            />

            {/* Context Menu */}
            <div
                className="fixed z-50"
                style={{
                    position: 'fixed',
                    zIndex: 999999,
                    left: `${adjustedX}px`,
                    top: `${adjustedY}px`,
                    minWidth: '220px',
                    padding: '8px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(15, 23, 42, 0.98)',
                    border: '1px solid #334155',
                    boxShadow: '0 20px 45px rgba(0,0,0,0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    color: '#f8fafc'
                }}
            >
                <button
                    onClick={() => handleAction(() => onExpandLeaves(node))}
                    disabled={isProcessing || !node.expanded}
                    className="disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontSize: '13px',
                        color: 'inherit',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: (isProcessing || !node.expanded) ? 'not-allowed' : 'pointer'
                    }}
                >
                    <Maximize size={16} className="text-emerald-400" />
                    <span>Expand Leaf Nodes</span>
                </button>

                <button
                    onClick={() => handleAction(() => onAddMore(node))}
                    disabled={isProcessing || !node.expanded}
                    className="disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontSize: '13px',
                        color: 'inherit',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: (isProcessing || !node.expanded) ? 'not-allowed' : 'pointer'
                    }}
                >
                    <Plus size={16} className="text-indigo-400" />
                    <span>Expand More</span>
                </button>

                <button
                    onClick={() => handleAction(() => onFindBetterPhoto(node.id))}
                    disabled={isProcessing}
                    className="disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontSize: '13px',
                        color: 'inherit',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: isProcessing ? 'not-allowed' : 'pointer'
                    }}
                >
                    <Sparkles size={16} className="text-amber-300" />
                    <span>Find Better Photo</span>
                </button>

                <div style={{ height: '1px', background: '#334155', margin: '6px 0' }} />

                <button
                    onClick={() => handleAction(() => onDelete(node.id))}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontSize: '13px',
                        color: '#f87171',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer'
                    }}
                >
                    <Trash2 size={16} />
                    <span>Delete Node</span>
                </button>
            </div>
        </>
    );
};

export default NodeContextMenu;
