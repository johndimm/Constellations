"use client";
import { useCallback, useEffect, useRef } from 'react';
import { GraphNode, GraphLink } from '../types';

export type NodeContextMenuState = { node: GraphNode; x: number; y: number };

export type NodeClickHandlers = {
    selectedNode: GraphNode | null;
    setSelectedNode: (node: GraphNode | null) => void;
    setContextMenu: (menu: NodeContextMenuState | null) => void;
    graphData?: { nodes: GraphNode[]; links: GraphLink[] };
    setExpandingNodeId?: (id: string | number | null) => void;
    setNewChildNodeIds?: (ids: Set<string>) => void;
    onDebug?: (message: string) => void;
    onDeselect?: () => void;
    onClearSecondarySelection?: () => void;
    onRetryImage?: (node: GraphNode) => void;
    onConnectSelect?: (node: GraphNode) => void;
    onExpandedSelect?: (node: GraphNode) => void;
    onExpand?: (node: GraphNode) => void | Promise<void>;
    onNavigate?: (node: GraphNode) => void;
    selectOnFirstClick?: boolean;
    shouldExpand?: (node: GraphNode) => boolean;
    getMenuPosition?: (node: GraphNode, event?: MouseEvent) => { x: number; y: number };
};

export const useNodeClickHandler = ({
    selectedNode,
    setSelectedNode,
    setContextMenu,
    graphData,
    setExpandingNodeId,
    setNewChildNodeIds,
    onDebug,
    onDeselect,
    onClearSecondarySelection,
    onRetryImage,
    onConnectSelect,
    onExpandedSelect,
    onExpand,
    onNavigate,
    selectOnFirstClick = true,
    shouldExpand,
    getMenuPosition
}: NodeClickHandlers) => {
    const lastSelectedIdRef = useRef<number | string | null>(selectedNode?.id ?? null);
    const lastClickRef = useRef<{ id: number | string; at: number } | null>(null);

    useEffect(() => {
        lastSelectedIdRef.current = selectedNode?.id ?? null;
    }, [selectedNode]);

    return useCallback(async (node: GraphNode | null, event?: MouseEvent) => {
        if (!node) {
            setSelectedNode(null);
            setContextMenu(null);
            lastSelectedIdRef.current = null;
            onDebug?.('click: none -> clear selection');
            onDeselect?.();
            return;
        }

        onRetryImage?.(node);
        onConnectSelect?.(node);

        const isSecondClick = lastSelectedIdRef.current !== null && String(lastSelectedIdRef.current) === String(node.id);
        const now = Date.now();
        const isRepeatSameNode = lastClickRef.current !== null && String(lastClickRef.current.id) === String(node.id);
        const lastClickAge = lastClickRef.current ? (now - lastClickRef.current.at) : null;
        const isRapidSameNode = isRepeatSameNode && !!lastClickAge && lastClickAge < 800;
        const isSelectedAgain = selectedNode !== null && String(selectedNode.id) === String(node.id);
        const isDoubleClick = !!event && typeof event.detail === 'number' && event.detail >= 2;
        if (isSecondClick || isRapidSameNode || isDoubleClick || isSelectedAgain || isRepeatSameNode) {
            const pos = getMenuPosition
                ? getMenuPosition(node, event)
                : {
                    x: event?.clientX ?? window.innerWidth / 2,
                    y: event?.clientY ?? window.innerHeight / 2
                };
            setContextMenu({ node, x: pos.x, y: pos.y });
            onDebug?.(
                `click: ${node.title} -> menu` +
                ` (second:${isSecondClick} rapid:${isRapidSameNode} dbl:${isDoubleClick}` +
                ` selected:${isSelectedAgain} repeat:${isRepeatSameNode}` +
                `${lastClickAge !== null ? ` age:${lastClickAge}` : ""})`
            );
            lastClickRef.current = { id: node.id, at: now };
            return;
        }

        setContextMenu(null);
        onClearSecondarySelection?.();

        if (node.expanded || node.isLoading) {
            setSelectedNode(node);
            lastSelectedIdRef.current = node.id;
            onExpandedSelect?.(node);
            onNavigate?.(node);
            lastClickRef.current = { id: node.id, at: now };
            onDebug?.(`click: ${node.title} -> select expanded:${!!node.expanded} loading:${!!node.isLoading}`);

            // Highlight the clicked node and all its connected nodes
            if (graphData && setExpandingNodeId && setNewChildNodeIds) {
                const connectedNodeIds: string[] = [];
                graphData.links.forEach(link => {
                    const sourceId = String(typeof link.source === 'object' ? (link.source as any).id : link.source);
                    const targetId = String(typeof link.target === 'object' ? (link.target as any).id : link.target);

                    if (String(sourceId) === String(node.id)) {
                        connectedNodeIds.push(String(targetId));
                    } else if (String(targetId) === String(node.id)) {
                        connectedNodeIds.push(String(sourceId));
                    }
                });

                setExpandingNodeId(node.id);
                setNewChildNodeIds(new Set(connectedNodeIds));
                onDebug?.(`highlight: ${node.title} + ${connectedNodeIds.length} connected nodes`);
            }

            return;
        }

        if (selectOnFirstClick) {
            setSelectedNode(node);
            lastSelectedIdRef.current = node.id;
            lastClickRef.current = { id: node.id, at: now };
            onDebug?.(`click: ${node.title} -> select`);

            // Highlight the clicked node and all its connected nodes
            if (graphData && setExpandingNodeId && setNewChildNodeIds) {
                const connectedNodeIds: string[] = [];
                graphData.links.forEach(link => {
                    const sourceId = String(typeof link.source === 'object' ? (link.source as any).id : link.source);
                    const targetId = String(typeof link.target === 'object' ? (link.target as any).id : link.target);

                    if (String(sourceId) === String(node.id)) {
                        connectedNodeIds.push(String(targetId));
                    } else if (String(targetId) === String(node.id)) {
                        connectedNodeIds.push(String(sourceId));
                    }
                });

                setExpandingNodeId(node.id);
                setNewChildNodeIds(new Set(connectedNodeIds));
                onDebug?.(`highlight: ${node.title} + ${connectedNodeIds.length} connected nodes`);
            }
        }

        onNavigate?.(node);

        if (!onExpand) return;
        const should = shouldExpand ? shouldExpand(node) : !(node.expanded || node.isLoading);
        if (!should) {
            onDebug?.(`click: ${node.title} -> skip expand`);
            return;
        }
        onDebug?.(`click: ${node.title} -> expand`);
        await onExpand(node);
        lastClickRef.current = { id: node.id, at: Date.now() };
    }, [
        selectedNode,
        setSelectedNode,
        setContextMenu,
        graphData,
        setExpandingNodeId,
        setNewChildNodeIds,
        onDebug,
        onDeselect,
        onClearSecondarySelection,
        onRetryImage,
        onConnectSelect,
        onExpandedSelect,
        onExpand,
        onNavigate,
        selectOnFirstClick,
        shouldExpand,
        getMenuPosition
    ]);
};
