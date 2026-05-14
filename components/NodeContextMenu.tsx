"use client";
import React from 'react';
import { GraphNode } from '../types';
import { ListMusic, Loader2, Maximize, Plus, Sparkles, Trash2 } from 'lucide-react';

interface NodeContextMenuProps {
    node: GraphNode;
    x: number;
    y: number;
    onExpandLeaves: (node: GraphNode) => void;
    onAddMore: (node: GraphNode) => void;
    onFindBetterPhoto: (nodeId: number | string) => void;
    /** When set (e.g. Soundings player), create a new channel seeded from this node. */
    onNewChannelFromNode?: (node: GraphNode) => void;
    onDelete: (node: GraphNode) => void;
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
    onNewChannelFromNode,
    onDelete,
    onClose,
    isProcessing
}) => {
    const handleAction = (action: () => void) => {
        action();
        onClose();
    };

    /**
     * During fetch, `useExpansion` sets both `expanded` and `isLoading` on the parent,
     * so we must not require `!expanded` — use `isLoading` only.
     * (The menu receives the live node from App so `isLoading` stays current while open.)
     */
    const expansionInProgress = Boolean(node.isLoading);
    /** While this node is expanding, do not block "new channel" on global isProcessing. */
    const newChannelDisabled = isProcessing && !expansionInProgress;

    // Calculate position to keep menu on screen
    const menuWidth = 220;
    const menuHeight = expansionInProgress
        ? (onNewChannelFromNode ? 150 : 100)
        : onNewChannelFromNode
            ? 230
            : 180;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 20);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 20);

    if (expansionInProgress) {
        return (
            <>
                <div
                    className="fixed inset-0 z-40"
                    style={{ position: 'fixed', inset: 0, zIndex: 999998 }}
                    onClick={onClose}
                />
                <div
                    className="fixed z-50"
                    style={{
                        position: 'fixed',
                        zIndex: 999999,
                        left: `${adjustedX}px`,
                        top: `${adjustedY}px`,
                        minWidth: '240px',
                        maxWidth: 'min(360px, 92vw)',
                        padding: '10px 10px 8px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                        border: '1px solid #334155',
                        boxShadow: '0 20px 45px rgba(0,0,0,0.35)',
                        color: '#f8fafc'
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            marginBottom: onNewChannelFromNode ? 10 : 0,
                            fontSize: '12px',
                            lineHeight: 1.35,
                            color: '#94a3b8'
                        }}
                    >
                        <Loader2 size={16} className="text-indigo-400 shrink-0 mt-0.5 animate-spin" />
                        <div>
                            <div className="text-slate-200 font-medium text-[13px] line-clamp-2" title={node.title}>
                                {node.title}
                            </div>
                            <div className="mt-0.5">Expanding connections…</div>
                        </div>
                    </div>
                    {onNewChannelFromNode && (
                        <button
                            onClick={() => handleAction(() => onNewChannelFromNode(node))}
                            disabled={newChannelDisabled}
                            className="disabled:opacity-50 disabled:cursor-not-allowed"
                            type="button"
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                textAlign: 'left',
                                fontSize: '13px',
                                color: 'inherit',
                                background: 'rgba(34, 211, 238, 0.08)',
                                border: '1px solid rgba(34, 211, 238, 0.25)',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: newChannelDisabled ? 'not-allowed' : 'pointer'
                            }}
                        >
                            <ListMusic size={16} className="text-cyan-400" />
                            <span>New channel from this node</span>
                        </button>
                    )}
                    {!onNewChannelFromNode && (
                        <p style={{ fontSize: '11px', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                            Open the menu again after expansion for more actions.
                        </p>
                    )}
                </div>
            </>
        );
    }

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

                {onNewChannelFromNode && (
                    <button
                        onClick={() => handleAction(() => onNewChannelFromNode(node))}
                        disabled={newChannelDisabled}
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
                            cursor: newChannelDisabled ? 'not-allowed' : 'pointer'
                        }}
                    >
                        <ListMusic size={16} className="text-cyan-400" />
                        <span>New channel from node</span>
                    </button>
                )}

                <div style={{ height: '1px', background: '#334155', margin: '6px 0' }} />

                <button
                    onClick={() => handleAction(() => onDelete(node))}
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
