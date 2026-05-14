"use client";
import React, { useCallback } from 'react';
import { GraphNode, GraphLink } from '../types';

interface UseGraphActionsOptions {
    nodes: GraphNode[];
    links: GraphLink[];
    setGraphData: React.Dispatch<React.SetStateAction<{ nodes: GraphNode[], links: GraphLink[] }>>;
    setSelectedNode: (node: GraphNode | null) => void;
    setSelectedLink: (link: GraphLink | null) => void;
    setContextMenu: (menu: any) => void;
    setNotification: (notif: any) => void;
    setConfirmDialog: (dialog: any) => void;
    setDeletePreview: (preview: any) => void;
    setPathNodeIds: (ids: (number | string)[]) => void;
    fetchAndExpandNode: (node: GraphNode, isInitial?: boolean, forceMore?: boolean) => Promise<void>;
    setIsProcessing: (val: boolean) => void;
    searchIdRef: React.MutableRefObject<number>;
    cacheEnabled: boolean;
    cacheBaseUrl: string;
    setSavedGraphs: React.Dispatch<React.SetStateAction<string[]>>;
    searchMode: 'explore' | 'connect';
    exploreTerm: string;
    pathStart: string;
    pathEnd: string;
    isCompact: boolean;
    isTimelineMode: boolean;
    isTextOnly: boolean;
    setExpandingNodeId: (id: number | string | null) => void;
    setNewChildNodeIds: (ids: Set<string | number>) => void;
}

export function useGraphActions(options: UseGraphActionsOptions) {
    const {
        nodes, links, setGraphData, setSelectedNode, setSelectedLink,
        setContextMenu, setNotification, setConfirmDialog, setDeletePreview,
        setPathNodeIds, fetchAndExpandNode, setIsProcessing, searchIdRef,
        cacheEnabled, cacheBaseUrl, setSavedGraphs, searchMode, exploreTerm,
        pathStart, pathEnd, isCompact, isTimelineMode, isTextOnly,
        setExpandingNodeId, setNewChildNodeIds
    } = options;

    const handleClear = useCallback(() => {
        setGraphData({ nodes: [], links: [] });
        setSelectedNode(null);
        setSelectedLink(null);
        setPathNodeIds([]);
    }, [setGraphData, setSelectedNode, setSelectedLink, setPathNodeIds]);

    const handleClearCache = useCallback(async () => {
        if (!cacheEnabled) {
            setNotification({ message: 'Cache is not enabled.', type: 'error' });
            return;
        }

        setConfirmDialog({
            isOpen: true,
            message: 'Clear all cached API data? This will force fresh data from the LLM on next expansion.',
            onConfirm: async () => {
                try {
                    setIsProcessing(true);
                    const res = await fetch(new URL('/cache/clear', cacheBaseUrl).toString(), {
                        method: 'DELETE'
                    });
                    if (!res.ok) throw new Error('Failed to clear cache');
                    setNotification({ message: 'Cache cleared successfully!', type: 'success' });
                } catch (e) {
                    console.error('Cache clear failed:', e);
                    setNotification({ message: 'Failed to clear cache.', type: 'error' });
                } finally {
                    setIsProcessing(false);
                }
            }
        });
    }, [cacheEnabled, cacheBaseUrl, setConfirmDialog, setNotification, setIsProcessing]);


    const handlePrune = useCallback(() => {
        const leafIds = nodes.filter(n => {
            const isSource = links.some(l => {
                const sid = String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source);
                return sid === String(n.id);
            });
            return !isSource;
        }).map(n => n.id);

        setGraphData(prev => ({
            nodes: prev.nodes.filter(n => !leafIds.some(id => String(id) === String(n.id))),
            links: prev.links.filter(l => {
                const s = String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source);
                const t = String(typeof l.target === 'object' ? (l.target as GraphNode).id : l.target);
                return !leafIds.some(id => String(id) === s) && !leafIds.some(id => String(id) === t);
            })
        }));
        setNotification({ message: 'Removed leaf nodes.', type: 'success' });
    }, [nodes, links, setGraphData, setNotification]);

    const computeDeleteOutcome = (nodeId: number | string) => {
        const keeps = new Set<string>();
        const stack = nodes.filter(n => {
            const isRoot = !links.some(l => {
                const tid = String(typeof l.target === 'object' ? (l.target as GraphNode).id : l.target);
                return tid === String(n.id);
            });
            return isRoot && String(n.id) !== String(nodeId);
        }).map(n => n.id);
        stack.forEach(id => keeps.add(String(id)));
        while (stack.length > 0) {
            const curr = stack.pop()!;
            links.forEach(l => {
                const s = String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source);
                const t = String(typeof l.target === 'object' ? (l.target as GraphNode).id : l.target);
                if (s === curr && !keeps.has(t) && t !== String(nodeId)) {
                    keeps.add(t);
                    stack.push(t);
                }
            });
        }
        const dropIds = nodes.map(n => n.id).filter(id => !keeps.has(String(id)));
        return { keepIds: Array.from(keeps), dropIds };
    };

    const handleSmartDelete = useCallback((node: GraphNode) => {
        if (!node) return;
        const nodeLabel = node.title || `Node ${node.id}`;
        const outcome = computeDeleteOutcome(node.id);
        setDeletePreview(outcome);
        setConfirmDialog({
            isOpen: true,
            message: `Delete "${nodeLabel}" and its sub-tree (${outcome.dropIds.length} nodes total)?`,
            onConfirm: () => {
                setGraphData(prev => ({
                    nodes: prev.nodes.filter(n => outcome.keepIds.some(id => String(id) === String(n.id))),
                    links: prev.links.filter(l => {
                        const s = String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source);
                        const t = String(typeof l.target === 'object' ? (l.target as GraphNode).id : l.target);
                        return outcome.keepIds.some(id => String(id) === s) && outcome.keepIds.some(id => String(id) === t);
                    })
                }));
                setSelectedNode(null);
                setDeletePreview(null);
                setNotification({ message: `Deleted ${node.title} and subtree.`, type: 'success' });
            }
        });
    }, [nodes, links, setDeletePreview, setConfirmDialog, setGraphData, setSelectedNode, setNotification]);

    const handleExpandLeaves = useCallback(async (node: GraphNode) => {
        const leafLinks = links.filter(l => String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source) === String(node.id));
        const leafIds = leafLinks.map(l => String(typeof l.target === 'object' ? (l.target as GraphNode).id : l.target));
        const unexpandedLeafIds = leafIds.filter(id => {
            const n = nodes.find(nn => String(nn.id) === String(id));
            return n && !n.expanded && !n.isLoading;
        });

        if (unexpandedLeafIds.length === 0) {
            setNotification({ message: "All connections already expanded.", type: 'success' });
            return;
        }

        setNotification({ message: `Expanding ${unexpandedLeafIds.length} connections...`, type: 'success' });
        for (const id of unexpandedLeafIds) {
            const n = nodes.find(nn => String(nn.id) === String(id));
            if (n) await fetchAndExpandNode(n, false, false);
        }
        setNotification({ message: `Completed expansion of ${unexpandedLeafIds.length} connections.`, type: 'success' });

        // Return graph to full brightness by clearing selection and highlighting
        setSelectedNode(null);
        setExpandingNodeId(null);
        setNewChildNodeIds(new Set());
    }, [nodes, links, fetchAndExpandNode, setNotification, setSelectedNode, setExpandingNodeId, setNewChildNodeIds]);

    const handleExpandMore = useCallback((node: GraphNode) => {
        fetchAndExpandNode(node, false, true);
    }, [fetchAndExpandNode]);

    const handleExpandAllLeafNodes = useCallback(async () => {
        const unexpandedLeafNodes = nodes.filter(n => {
            const isSource = links.some(l => String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source) === String(n.id));
            return !isSource && !n.expanded && !n.isLoading;
        });

        if (unexpandedLeafNodes.length === 0) {
            setNotification({ message: "Current graph is fully expanded.", type: 'success' });
            return;
        }

        const count = unexpandedLeafNodes.length;
        setNotification({ message: `Batch expanding ${count} leaf nodes...`, type: 'success' });
        for (const n of unexpandedLeafNodes) {
            await fetchAndExpandNode(n, false, false);
        }
        setNotification({ message: `Completed batch expansion of ${count} nodes.`, type: 'success' });

        // Return graph to full brightness by clearing selection and highlighting
        setSelectedNode(null);
        setExpandingNodeId(null);
        setNewChildNodeIds(new Set());
    }, [nodes, links, fetchAndExpandNode, setNotification, setSelectedNode, setExpandingNodeId, setNewChildNodeIds]);

    const handleDeleteGraph = useCallback((name: string) => {
        setConfirmDialog({
            isOpen: true,
            message: `Are you sure you want to delete "${name}"?`,
            onConfirm: async () => {
                if (cacheEnabled) {
                    try {
                        const res = await fetch(new URL(`/graphs/${encodeURIComponent(name)}`, cacheBaseUrl).toString(), {
                            method: "DELETE"
                        });
                        if (!res.ok) throw new Error("Database delete failed");
                        setSavedGraphs(prev => prev.filter(n => n !== name));
                        setNotification({ message: `Graph "${name}" deleted.`, type: 'success' });
                    } catch (e) {
                        console.error("Database delete failed", e);
                        setNotification({ message: "Failed to delete graph.", type: 'error' });
                    }
                }
            }
        });
    }, [cacheEnabled, cacheBaseUrl, setConfirmDialog, setSavedGraphs, setNotification]);

    const handleSaveGraph = useCallback(async (nameOrSpecial?: string) => {
        if (nameOrSpecial === '__COPY_LINK__') {
            const baseUrl = window.location.origin + window.location.pathname;
            const url = new URL(baseUrl);
            if (searchMode === 'connect') {
                if (pathStart) url.searchParams.set('start', pathStart);
                if (pathEnd) url.searchParams.set('end', pathEnd);
            } else if (exploreTerm) {
                url.searchParams.set('q', exploreTerm);
            }
            const shareUrl = url.toString();

            try {
                await navigator.clipboard.writeText(shareUrl);
                setNotification({ message: `Link copied to clipboard!`, type: 'success' });
            } catch (e) {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = shareUrl;
                document.body.appendChild(textarea);
                textarea.select();
                try {
                    document.execCommand('copy');
                    setNotification({ message: `Link copied to clipboard!`, type: 'success' });
                } catch (err) {
                    console.error('Copy fallback failed:', err);
                    setNotification({ message: `Failed to copy link.`, type: 'error' });
                }
                document.body.removeChild(textarea);
            }
            return;
        }

        const name = nameOrSpecial || prompt("Enter a name for this graph:");
        if (!name) return;

        const data = {
            nodes, links, searchMode, exploreTerm, pathStart, pathEnd,
            isCompact, isTimelineMode, isTextOnly,
            timestamp: Date.now()
        };

        if (cacheEnabled) {
            try {
                await fetch(new URL("/graphs", cacheBaseUrl).toString(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, data })
                });
                setSavedGraphs(prev => Array.from(new Set([...prev, name])));
                setNotification({ message: `Graph "${name}" saved!`, type: 'success' });
            } catch (e) {
                console.error("Database save failed", e);
                setNotification({ message: "Failed to save graph.", type: 'error' });
            }
        }
    }, [nodes, links, searchMode, exploreTerm, pathStart, pathEnd, isCompact, isTimelineMode, isTextOnly, cacheEnabled, cacheBaseUrl, setSavedGraphs, setNotification]);

    const handleLoadGraph = useCallback(async (name: string, applyGraphData: (data: any, label: string) => void) => {
        if (cacheEnabled) {
            try {
                const res = await fetch(new URL(`/graphs/${encodeURIComponent(name)}`, cacheBaseUrl).toString());
                if (res.ok) {
                    const json = await res.json();
                    applyGraphData(json, name);
                } else {
                    throw new Error("Graph not found");
                }
            } catch (e) {
                console.warn("Database load failed", e);
                setNotification({ message: `Failed to load "${name}".`, type: 'error' });
            }
        }
    }, [cacheEnabled, cacheBaseUrl, setNotification]);

    const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>, applyGraphData: (data: any, label: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                applyGraphData(data, file.name);
            } catch (err) {
                setNotification({ message: "Invalid JSON json file.", type: 'error' });
            }
        };
        reader.readAsText(file);
    }, [setNotification]);

    return {
        handleClear,
        handleClearCache,
        handlePrune,
        handleSmartDelete,
        handleExpandLeaves,
        handleExpandMore,
        handleExpandAllLeafNodes,
        handleDeleteGraph,
        handleSaveGraph,
        handleLoadGraph,
        handleImport
    };
}
