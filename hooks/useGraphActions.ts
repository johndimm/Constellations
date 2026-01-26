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
    setPathNodeIds: (ids: number[]) => void;
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
}

export function useGraphActions(options: UseGraphActionsOptions) {
    const {
        nodes, links, setGraphData, setSelectedNode, setSelectedLink,
        setContextMenu, setNotification, setConfirmDialog, setDeletePreview,
        setPathNodeIds, fetchAndExpandNode, setIsProcessing, searchIdRef,
        cacheEnabled, cacheBaseUrl, setSavedGraphs, searchMode, exploreTerm,
        pathStart, pathEnd, isCompact, isTimelineMode, isTextOnly
    } = options;

    const handleClear = useCallback(() => {
        setGraphData({ nodes: [], links: [] });
        setSelectedNode(null);
        setSelectedLink(null);
        setPathNodeIds([]);
    }, [setGraphData, setSelectedNode, setSelectedLink, setPathNodeIds]);

    const handlePrune = useCallback(() => {
        const leafIds = nodes.filter(n => {
            const isSource = links.some(l => (typeof l.source === 'number' ? l.source : (l.source as any).id) === n.id);
            return !isSource;
        }).map(n => n.id);

        setGraphData(prev => ({
            nodes: prev.nodes.filter(n => !leafIds.includes(n.id)),
            links: prev.links.filter(l => {
                const s = typeof l.source === 'number' ? l.source : (l.source as any).id;
                const t = typeof l.target === 'number' ? l.target : (l.target as any).id;
                return !leafIds.includes(s) && !leafIds.includes(t);
            })
        }));
        setNotification({ message: 'Removed leaf nodes.', type: 'success' });
    }, [nodes, links, setGraphData, setNotification]);

    const computeDeleteOutcome = (nodeId: number) => {
        const keeps = new Set<number>();
        const stack = nodes.filter(n => {
            const isRoot = !links.some(l => (typeof l.target === 'number' ? l.target : (l.target as any).id) === n.id);
            return isRoot && n.id !== nodeId;
        }).map(n => n.id);
        stack.forEach(id => keeps.add(id));
        while (stack.length > 0) {
            const curr = stack.pop()!;
            links.forEach(l => {
                const s = typeof l.source === 'number' ? l.source : (l.source as any).id;
                const t = typeof l.target === 'number' ? l.target : (l.target as any).id;
                if (s === curr && !keeps.has(t) && t !== nodeId) {
                    keeps.add(t);
                    stack.push(t);
                }
            });
        }
        const dropIds = nodes.map(n => n.id).filter(id => !keeps.has(id));
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
                    nodes: prev.nodes.filter(n => outcome.keepIds.includes(n.id)),
                    links: prev.links.filter(l => {
                        const s = typeof l.source === 'number' ? l.source : (l.source as any).id;
                        const t = typeof l.target === 'number' ? l.target : (l.target as any).id;
                        return outcome.keepIds.includes(s) && outcome.keepIds.includes(t);
                    })
                }));
                setSelectedNode(null);
                setDeletePreview(null);
                setNotification({ message: `Deleted ${node.title} and subtree.`, type: 'success' });
            }
        });
    }, [nodes, links, setDeletePreview, setConfirmDialog, setGraphData, setSelectedNode, setNotification]);

    const handleExpandLeaves = useCallback(async (node: GraphNode) => {
        const leafLinks = links.filter(l => (typeof l.source === 'number' ? l.source : (l.source as any).id) === node.id);
        const leafIds = leafLinks.map(l => (typeof l.target === 'number' ? l.target : (l.target as any).id));
        const unexpandedLeafIds = leafIds.filter(id => {
            const n = nodes.find(nn => nn.id === id);
            return n && !n.expanded && !n.isLoading;
        });

        if (unexpandedLeafIds.length === 0) {
            setNotification({ message: "All connections already expanded.", type: 'success' });
            return;
        }

        setNotification({ message: `Expanding ${unexpandedLeafIds.length} connections...`, type: 'success' });
        for (const id of unexpandedLeafIds) {
            const n = nodes.find(nn => nn.id === id);
            if (n) await fetchAndExpandNode(n, false, false);
        }
        setNotification({ message: `Completed expansion of ${unexpandedLeafIds.length} connections.`, type: 'success' });
    }, [nodes, links, fetchAndExpandNode, setNotification]);

    const handleExpandMore = useCallback((node: GraphNode) => {
        fetchAndExpandNode(node, false, true);
    }, [fetchAndExpandNode]);

    const handleExpandAllLeafNodes = useCallback(async () => {
        const unexpandedLeafNodes = nodes.filter(n => {
            const isSource = links.some(l => (typeof l.source === 'number' ? l.source : (l.source as any).id) === n.id);
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
    }, [nodes, links, fetchAndExpandNode, setNotification]);

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
                    } catch (e) {
                        console.warn("Database delete failed, removing from local storage only", e);
                    }
                }
                localStorage.removeItem(`constellations_graph_${name}`);
                setSavedGraphs(prev => prev.filter(n => n !== name));
                setNotification({ message: `Graph "${name}" deleted.`, type: 'success' });
            }
        });
    }, [cacheEnabled, cacheBaseUrl, setConfirmDialog, setSavedGraphs, setNotification]);

    const handleSaveGraph = useCallback(async () => {
        const name = prompt("Enter a name for this graph:");
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
            } catch (e) {
                console.warn("Database save failed, saving to local storage only", e);
            }
        }
        localStorage.setItem(`constellations_graph_${name}`, JSON.stringify(data));
        setSavedGraphs(prev => Array.from(new Set([...prev, name])));
        setNotification({ message: `Graph "${name}" saved!`, type: 'success' });
    }, [nodes, links, searchMode, exploreTerm, pathStart, pathEnd, isCompact, isTimelineMode, isTextOnly, cacheEnabled, cacheBaseUrl, setSavedGraphs, setNotification]);

    const handleLoadGraph = useCallback(async (name: string, applyGraphData: (data: any, label: string) => void) => {
        let data: any = null;
        if (cacheEnabled) {
            try {
                const res = await fetch(new URL(`/graphs/${encodeURIComponent(name)}`, cacheBaseUrl).toString());
                if (res.ok) {
                    const json = await res.json();
                    data = json.data;
                }
            } catch (e) { console.warn("Database load failed, checking local storage", e); }
        }
        if (!data) {
            const local = localStorage.getItem(`constellations_graph_${name}`);
            if (local) data = JSON.parse(local);
        }
        if (data) applyGraphData(data, name);
        else setNotification({ message: `Failed to load "${name}".`, type: 'error' });
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
