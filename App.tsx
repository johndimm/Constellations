import React, { useState, useEffect, useCallback } from 'react';
import Graph from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import { GraphNode, GraphLink } from './types';
import { fetchConnections, fetchPersonWorks, classifyEntity, fetchConnectionPath } from './services/geminiService';
import { fetchWikipediaImage } from './services/wikipediaService';
import { Key } from 'lucide-react';

const getEnvApiKey = () => {
    let key = "";
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            // @ts-ignore
            key = import.meta.env.VITE_API_KEY || import.meta.env.NEXT_PUBLIC_API_KEY || import.meta.env.API_KEY || "";
        }
    } catch (e) { }
    if (key) return key;
    try {
        if (typeof process !== 'undefined' && process.env) {
            key = process.env.VITE_API_KEY || process.env.NEXT_PUBLIC_API_KEY || process.env.REACT_APP_API_KEY || process.env.API_KEY || "";
        }
    } catch (e) { }
    return key;
};

// Normalize string for deduplication: lower case, remove 'the ', remove punctuation
const normalizeForDedup = (str: string) => {
    return str.trim().toLowerCase()
        .replace(/^the\s+/i, '') // Remove leading "The "
        .replace(/[^\w\s]/g, '') // Remove punctuation like quotes/dots
        .replace(/\s+/g, ' ');   // Collapse spaces
};

const App: React.FC = () => {
    const [nodes, setNodes] = useState<GraphNode[]>([]);
    const [links, setLinks] = useState<GraphLink[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [isCompact, setIsCompact] = useState(false);
    const [isTimelineMode, setIsTimelineMode] = useState(false);
    const [isTextOnly, setIsTextOnly] = useState(false);
    const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
    const [error, setError] = useState<string | null>(null);
    const [isKeyReady, setIsKeyReady] = useState(false);

    // Search State Lifted
    const [searchMode, setSearchMode] = useState<'explore' | 'connect'>('explore');
    const [exploreTerm, setExploreTerm] = useState('');
    const [pathStart, setPathStart] = useState('');
    const [pathEnd, setPathEnd] = useState('');
    const [searchId, setSearchId] = useState(0);

    useEffect(() => {
        const checkParams = async () => {
            const params = new URLSearchParams(window.location.search);
            const query = params.get('q');
            const start = params.get('start');
            const end = params.get('end');

            if (query && isKeyReady) {
                setExploreTerm(query);
                handleStartSearch(query, 1);
            } else if (start && end && isKeyReady) {
                setPathStart(start);
                setPathEnd(end);
                setSearchMode('connect');
                handlePathSearch(start, end);
            }
        };
        checkParams();
    }, [isKeyReady]);

    useEffect(() => {
        const checkKey = async () => {
            const envKey = getEnvApiKey();
            if ((window as any).aistudio) {
                const hasKey = await (window as any).aistudio.hasSelectedApiKey();
                setIsKeyReady(hasKey || !!envKey);
            } else {
                if (envKey) setIsKeyReady(true);
            }
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        if ((window as any).aistudio) {
            await (window as any).aistudio.openSelectKey();
            setIsKeyReady(true);
        }
    };

    useEffect(() => {
        const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const loadNodeImage = useCallback(async (nodeId: string) => {
        if (isTextOnly) return;

        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: true } : n));
        const url = await fetchWikipediaImage(nodeId);
        if (url) {
            setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: url, fetchingImage: false, imageChecked: true } : n));
        } else {
            setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: false, imageChecked: true } : n));
        }
    }, [isTextOnly]);

    const handleClear = () => {
        setNodes([]);
        setLinks([]);
        setSelectedNode(null);
        // Do not clear search terms as per user request
        // setExploreTerm('');
        // setPathStart('');
        // setPathEnd('');
        setError(null);
    };

    // Helper to find specific existing node ID if it matches fuzzily
    const resolveNodeId = useCallback((candidate: string, currentNodes: GraphNode[], pendingNodes: GraphNode[]) => {
        const norm = normalizeForDedup(candidate);

        // Check pending first (batch priority)
        const pendingMatch = pendingNodes.find(n => normalizeForDedup(n.id) === norm);
        if (pendingMatch) return pendingMatch.id;

        // Check existing
        const existingMatch = currentNodes.find(n => normalizeForDedup(n.id) === norm);
        if (existingMatch) return existingMatch.id;

        return candidate.trim();
    }, []);

    const handleStartSearch = async (term: string, recursiveDepth = 0) => {
        setIsProcessing(true);
        setError(null);
        setSearchId(prev => prev + 1);

        let type = 'Event';
        try {
            // Determine if it's a Person or a Thing (Event/Movie/etc)
            type = await classifyEntity(term);

            const startNode: GraphNode = {
                id: term.trim(),
                type: type,
                description: 'The starting point of your journey.',
                x: dimensions.width / 2,
                y: dimensions.height / 2,
            };

            setNodes([startNode]);
            setLinks([]);
            setSelectedNode(startNode);
            loadNodeImage(startNode.id);

            await expandNode(startNode, true);

            if (recursiveDepth > 0) {
                setNotification({ message: "Auto-expanding connections...", type: 'success' });
                // We need to wait for the nodes to be updated in the state or get them from the links
                // However, expandNode updates the 'nodes' and 'links' state asynchronously.
                // We'll use a small delay and then look at the current links to find the neighbors.
                await new Promise(resolve => setTimeout(resolve, 800));

                // Get neighbors from links
                setLinks(currentLinks => {
                    const neighbors = new Set<string>();
                    currentLinks.forEach(l => {
                        const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                        const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                        if (s === startNode.id) neighbors.add(t);
                        else if (t === startNode.id) neighbors.add(s);
                    });

                    // Now we expand each neighbor
                    setNodes(currentNodes => {
                        neighbors.forEach(neighborId => {
                            const nodeToExpand = currentNodes.find(n => n.id === neighborId);
                            if (nodeToExpand && !nodeToExpand.expanded) {
                                expandNode(nodeToExpand);
                            }
                        });
                        return currentNodes;
                    });

                    return currentLinks;
                });
            }
        } catch (e) {
            console.error("Search error", e);
            setError("Search failed.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePathSearch = async (start: string, end: string) => {
        setIsProcessing(true);
        setError(null);
        setSearchId(prev => prev + 1);

        // Clear screen first as requested
        setNodes([]);
        setLinks([]);
        setSelectedNode(null);

        try {
            // 1. Classify start and end
            const [startType, endType] = await Promise.all([
                classifyEntity(start),
                classifyEntity(end)
            ]);

            const startNode: GraphNode = {
                id: start.trim(),
                type: startType,
                description: 'Start of path discovery.',
                x: dimensions.width / 4,
                y: dimensions.height / 2,
                expanded: false
            };

            const endNode: GraphNode = {
                id: end.trim(),
                type: endType,
                description: 'Destination of path discovery.',
                x: (dimensions.width / 4) * 3,
                y: dimensions.height / 2,
                expanded: false
            };

            // Set initial state ONCE to avoid multiple layout resets
            setNodes([startNode, endNode]);
            setLinks([]); // Reset links explicitly
            loadNodeImage(startNode.id);
            loadNodeImage(endNode.id);

            // 2. Expand both endpoints concurrently to show "work"
            setNotification({ message: `Exploring "${start}" and "${end}"...`, type: 'success' });

            // Wait a small bit for initial nodes to render
            await new Promise(resolve => setTimeout(resolve, 300));

            try {
                // Expanding endpoints should NOT clear the path nodes we just added
                await Promise.all([
                    expandNode(startNode, true).catch(e => console.warn("Start expansion failed", e)),
                    expandNode(endNode, true).catch(e => console.warn("End expansion failed", e))
                ]);
            } catch (e) {
                console.warn("Endpoints expansion partially failed", e);
            }

            // 3. Fetch the path in background
            setNotification({ message: "Finding hidden connections...", type: 'success' });

            // Thinking messages loop to avoid "dead air"
            const thinkingMessages = [
                "Scanning world history...",
                "Analyzing relationships...",
                "Connecting the dots...",
                "Consulting historical records...",
                "Building the bridge..."
            ];
            let msgIndex = 0;
            const thinkingInterval = setInterval(() => {
                setNotification({ message: thinkingMessages[msgIndex], type: 'success' });
                msgIndex = (msgIndex + 1) % thinkingMessages.length;
            }, 3000);

            let pathData;
            try {
                pathData = await fetchConnectionPath(start, end);
            } catch (err: any) {
                if (err.message?.includes("timed out")) {
                    setError("Pathfinding timed out. The connection might be too complex or obscure.");
                } else {
                    setError("The AI failed to find a connection. Try more common entities.");
                }
                return;
            } finally {
                clearInterval(thinkingInterval);
            }

            if (!pathData.path || pathData.path.length < 2) {
                setError("The AI couldn't bridge these two entities. Try a different pair.");
                return;
            }

            // 4. Discover path one by one
            let currentTailId = startNode.id;
            const steps = pathData.path.length - 1;

            for (let i = 1; i <= steps; i++) {
                const step = pathData.path[i];
                await new Promise(resolve => setTimeout(resolve, 500));

                setNotification({
                    message: `Stitching path... step ${i} of ${steps}: ${step.id}`,
                    type: 'success'
                });

                const tailId = currentTailId;
                const currentStep = step;
                let nodeToExpand: GraphNode | null = null;
                let resolvedIdForNextStep = currentStep.id;

                setNodes(currentNodes => {
                    const norm = normalizeForDedup(currentStep.id);
                    const existing = currentNodes.find(n => normalizeForDedup(n.id) === norm);
                    const resolvedId = existing ? existing.id : currentStep.id;
                    resolvedIdForNextStep = resolvedId;

                    const newNode: GraphNode = existing ? {
                        ...existing,
                        description: currentStep.description,
                        year: currentStep.year || existing.year,
                        expanded: existing.expanded
                    } : {
                        id: currentStep.id,
                        type: currentStep.type,
                        description: currentStep.description,
                        year: currentStep.year,
                        // Place intermediate nodes between clusters to reduce drift
                        x: (dimensions.width / 2) + (i - steps / 2) * 50,
                        y: (dimensions.height / 2) + Math.sin(i) * 50,
                        expanded: false
                    };

                    nodeToExpand = newNode;

                    const updatedNodes = existing
                        ? currentNodes.map(n => n.id === existing.id ? newNode : n)
                        : [...currentNodes, newNode];

                    setSelectedNode(newNode);

                    setLinks(currentLinks => {
                        const linkId = `${tailId}-${resolvedId}`;
                        const reverseLinkId = `${resolvedId}-${tailId}`;
                        if (currentLinks.some(l => l.id === linkId || l.id === reverseLinkId)) return currentLinks;

                        return [...currentLinks, {
                            source: tailId,
                            target: resolvedId,
                            id: linkId,
                            label: currentStep.justification || "Connected"
                        }];
                    });

                    loadNodeImage(resolvedId);
                    return updatedNodes;
                });

                // Trigger expansion on the intermediate node to "show work" as requested by user
                if (nodeToExpand) {
                    const target = nodeToExpand;
                    setTimeout(() => {
                        expandNode(target).catch(e => console.warn("Intermediate expansion failed", e));
                    }, 100);
                }

                currentTailId = resolvedIdForNextStep;
            }

            setNotification({ message: "Path discovery complete!", type: 'success' });

        } catch (err) {
            console.error("Path search failed", err);
            setError("An unexpected error occurred. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePrune = () => {
        const linkCounts = new Map<string, number>();
        links.forEach(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            linkCounts.set(s, (linkCounts.get(s) || 0) + 1);
            linkCounts.set(t, (linkCounts.get(t) || 0) + 1);
        });

        const nodesToKeep = nodes.filter(n => {
            if (selectedNode && n.id === selectedNode.id) return true;
            if ((linkCounts.get(n.id) || 0) > 1) return true;
            return false;
        });

        const nodeIdsToKeep = new Set(nodesToKeep.map(n => n.id));
        const linksToKeep = links.filter(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            return nodeIdsToKeep.has(s) && nodeIdsToKeep.has(t);
        });

        setNodes(nodesToKeep);
        setLinks(linksToKeep);
    };

    const expandNode = useCallback(async (node: GraphNode, isInitial = false, forceMore = false) => {
        if (!forceMore && (node.expanded || node.isLoading)) return;

        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: true } : n));
        setIsProcessing(true);
        setError(null);

        try {
            let newNodes: GraphNode[] = [];
            let newLinks: GraphLink[] = [];
            const nodeUpdates = new Map<string, Partial<GraphNode>>();

            if (node.type === 'Person') {
                const neighborLinks = links.filter(l =>
                    (typeof l.source === 'string' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                    (typeof l.target === 'string' ? l.target === node.id : (l.target as GraphNode).id === node.id)
                );
                const neighborNames = neighborLinks.map(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                    return s === node.id ? t : s;
                });

                const data = await fetchPersonWorks(node.id, neighborNames);

                data.works.forEach(work => {
                    const resolvedId = resolveNodeId(work.entity, nodes, newNodes);
                    const existingNode = nodes.find(n => n.id === resolvedId);
                    const pendingNode = newNodes.find(n => n.id === resolvedId);

                    if (!existingNode && !pendingNode) {
                        const newNode: GraphNode = {
                            id: resolvedId,
                            type: work.type,
                            description: work.description,
                            year: work.year,
                            x: (node.x || 0) + (Math.random() - 0.5) * 200,
                            y: (node.y || 0) + (Math.random() - 0.5) * 200,
                        };
                        newNodes.push(newNode);
                    } else {
                        if (existingNode && !existingNode.year && work.year) {
                            nodeUpdates.set(existingNode.id, { year: work.year });
                        }
                    }

                    const linkId = `${node.id}-${resolvedId}`;
                    const reverseLinkId = `${resolvedId}-${node.id}`;
                    const linkExists = links.some(l => l.id === linkId || l.id === reverseLinkId) ||
                        newLinks.some(l => l.id === linkId || l.id === reverseLinkId);

                    if (!linkExists) {
                        newLinks.push({
                            source: node.id,
                            target: resolvedId,
                            id: linkId,
                            label: work.year.toString()
                        });
                    }
                });

            } else {
                // Find context for Event/Thing node expansion
                const nodeNeighbors = links.filter(l =>
                    (typeof l.source === 'string' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                    (typeof l.target === 'string' ? l.target === node.id : (l.target as GraphNode).id === node.id)
                );

                const neighborIds = nodeNeighbors.map(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                    return s === node.id ? t : s;
                });

                // Find a neighbor that is a Person to use as context
                const contextPerson = nodes.find(n => neighborIds.includes(n.id) && n.type === 'Person');
                const context = contextPerson ? contextPerson.id : undefined;

                const data = await fetchConnections(node.id, context, neighborIds);

                if (data.sourceYear) {
                    nodeUpdates.set(node.id, { year: data.sourceYear });
                }

                if (!data.people || data.people.length === 0) {
                    if (isInitial) {
                        setError(`No connections found for "${node.id}".`);
                        setNodes([]);
                        setSelectedNode(null);
                        setIsProcessing(false);
                        return;
                    } else {
                        nodeUpdates.set(node.id, { ...nodeUpdates.get(node.id), isLoading: false, expanded: true });
                    }
                } else {
                    data.people.forEach((person) => {
                        const resolvedId = resolveNodeId(person.name, nodes, newNodes);
                        const existingNode = nodes.find(n => n.id === resolvedId);
                        const pendingNode = newNodes.find(n => n.id === resolvedId);

                        if (!existingNode && !pendingNode) {
                            newNodes.push({
                                id: resolvedId,
                                type: 'Person',
                                description: person.description,
                                x: (node.x || 0) + (Math.random() - 0.5) * 150,
                                y: (node.y || 0) + (Math.random() - 0.5) * 150,
                                expanded: false
                            });
                        }

                        const linkId = `${node.id}-${resolvedId}`;
                        const reverseLinkId = `${resolvedId}-${node.id}`;
                        const linkExists = links.some(l => l.id === linkId || l.id === reverseLinkId) ||
                            newLinks.some(l => l.id === linkId || l.id === reverseLinkId);

                        if (!linkExists) {
                            newLinks.push({
                                source: node.id,
                                target: resolvedId,
                                id: linkId,
                                label: person.role
                            });
                        }
                    });
                }
            }

            setNodes(prev => {
                const existingMap = new Map<string, GraphNode>(prev.map(n => [n.id, n] as [string, GraphNode]));
                const collisions = newNodes.filter(n => existingMap.has(n.id));
                const trulyNew = newNodes.filter(n => !existingMap.has(n.id));

                nodeUpdates.forEach((updates, id) => {
                    if (existingMap.has(id)) {
                        existingMap.set(id, { ...existingMap.get(id)!, ...updates });
                    }
                });

                collisions.forEach(col => {
                    const ex = existingMap.get(col.id)!;
                    const updated = { ...ex };
                    let changed = false;
                    if (!updated.year && col.year) { updated.year = col.year; changed = true; }
                    if (!updated.description && col.description) { updated.description = col.description; changed = true; }
                    if (changed) existingMap.set(col.id, updated);
                });

                if (existingMap.has(node.id)) {
                    existingMap.set(node.id, {
                        ...existingMap.get(node.id)!,
                        isLoading: false,
                        expanded: true
                    });
                }
                return [...Array.from(existingMap.values()), ...trulyNew];
            });

            setLinks(prev => {
                const existingLinkIds = new Set(prev.map(l => l.id));
                const trulyNewLinks = newLinks.filter(l => !existingLinkIds.has(l.id));
                return [...prev, ...trulyNewLinks];
            });

            newNodes.forEach((n, index) => {
                setTimeout(() => {
                    loadNodeImage(n.id);
                }, 300 * (index + 1));
            });

        } catch (error) {
            console.error("Failed to expand node", error);
            setError("Failed to fetch connections. The AI might be busy.");
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: false } : n));
        } finally {
            setIsProcessing(false);
        }
    }, [nodes, links, loadNodeImage, resolveNodeId]);

    const handleExpandMore = (node: GraphNode) => {
        expandNode(node, false, true);
    };

    const handleRecursiveDelete = (rootId: string) => {
        const nodesToRemove = new Set<string>();
        const queue = [rootId];
        nodesToRemove.add(rootId);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            links.forEach(l => {
                const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;

                if (s === currentId && !nodesToRemove.has(t)) {
                    nodesToRemove.add(t);
                    queue.push(t);
                } else if (t === currentId && !nodesToRemove.has(s)) {
                    nodesToRemove.add(s);
                    queue.push(s);
                }
            });
        }

        setConfirmDialog({
            isOpen: true,
            message: `Delete "${rootId}" and ${nodesToRemove.size - 1} other connected nodes?`,
            onConfirm: () => {
                setNodes(prev => prev.filter(n => !nodesToRemove.has(n.id)));
                setLinks(prev => prev.filter(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                    return !nodesToRemove.has(s) && !nodesToRemove.has(t);
                }));
                setSelectedNode(null);
                setConfirmDialog(null);
                setNotification({ message: "Branch deleted.", type: 'success' });
            }
        });
    };

    const handleNodeClick = (node: GraphNode) => {
        // Retry image fetch if it failed previously
        if (node.imageChecked && !node.imageUrl) {
            loadNodeImage(node.id);
        }

        setSelectedNode(node);
        if (!node.expanded) {
            expandNode(node);
        }
    };

    const handleViewportChange = useCallback((visibleNodes: GraphNode[]) => {
        if (visibleNodes.length <= 15 && !isTextOnly) {
            visibleNodes.forEach((node, index) => {
                if (!node.imageUrl && !node.fetchingImage && !node.imageChecked) {
                    setTimeout(() => {
                        loadNodeImage(node.id);
                    }, 200 * index);
                }
            });
        }
    }, [loadNodeImage, isTextOnly]);

    const [savedGraphs, setSavedGraphs] = useState<string[]>([]);

    useEffect(() => {
        // Load saved graph names on mount
        const loadSavedNames = () => {
            const saved = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('constellations_graph_')) {
                    saved.push(key.replace('constellations_graph_', ''));
                }
            }
            setSavedGraphs(saved.sort());
        };
        loadSavedNames();
    }, []);

    // Notification & Confirm State
    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, message: string, onConfirm: () => void } | null>(null);

    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const handleSaveGraph = (name: string) => {
        if (name === '__COPY_LINK__') {
            const baseUrl = window.location.origin + window.location.pathname;
            let url = baseUrl;
            if (searchMode === 'explore' && exploreTerm) {
                url += `?q=${encodeURIComponent(exploreTerm)}`;
            } else if (searchMode === 'connect' && pathStart && pathEnd) {
                url += `?start=${encodeURIComponent(pathStart)}&end=${encodeURIComponent(pathEnd)}`;
            }

            navigator.clipboard.writeText(url).then(() => {
                setNotification({ message: "Share link copied to clipboard!", type: 'success' });
            }).catch(err => {
                console.error('Failed to copy link: ', err);
                setNotification({ message: "Failed to copy link.", type: 'error' });
            });
            return;
        }

        if (name === '__EXPORT__' || name === '__COPY__') {
            const data = {
                nodes: nodes,
                links: links,
                timestamp: Date.now()
            };
            const json = JSON.stringify(data, null, 2);

            if (name === '__COPY__') {
                navigator.clipboard.writeText(json).then(() => {
                    setNotification({ message: "Graph JSON copied to clipboard!", type: 'success' });
                }).catch(err => {
                    console.error('Failed to copy: ', err);
                    setNotification({ message: "Failed to copy to clipboard.", type: 'error' });
                });
                return;
            }

            // Generate descriptive filename
            let baseName = "graph";
            if (searchMode === 'explore' && exploreTerm) {
                baseName = exploreTerm;
            } else if (searchMode === 'connect' && pathStart && pathEnd) {
                baseName = `${pathStart}_to_${pathEnd}`;
            }
            const safeName = baseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safeName}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setNotification({ message: `Graph "${safeName}.json" downloaded!`, type: 'success' });
            return;
        }

        const graphData = {
            nodes: nodes,
            links: links,
            searchMode,
            exploreTerm,
            pathStart,
            pathEnd,
            isCompact,
            isTimelineMode,
            isTextOnly,
            date: Date.now()
        };
        localStorage.setItem(`constellations_graph_${name}`, JSON.stringify(graphData));
        setSavedGraphs(prev => prev.includes(name) ? prev : [...prev, name].sort());
        setNotification({ message: `Graph "${name}" saved!`, type: 'success' });
    };

    const handleImport = (data: any) => {
        try {
            if (!data.nodes || !data.links) throw new Error("Missing nodes or links");
            setNodes(data.nodes.map((n: any) => ({ ...n })));
            setLinks(data.links.map((l: any) => ({ ...l })));
            setNotification({ message: "Graph imported successfully!", type: 'success' });
        } catch (e) {
            console.error(e);
            setNotification({ message: "Failed to import graph.", type: 'error' });
        }
    };

    const handleLoadGraph = (name: string) => {
        const dataStr = localStorage.getItem(`constellations_graph_${name}`);
        if (!dataStr) return;

        try {
            const data = JSON.parse(dataStr);
            const savedNodes = data.nodes || [];
            const savedLinks = data.links || [];

            if (savedNodes.length === 0) {
                setNotification({ message: `Graph "${name}" is empty.`, type: 'error' });
                return;
            }

            // Restore other state
            if (data.searchMode) setSearchMode(data.searchMode);
            if (data.exploreTerm) setExploreTerm(data.exploreTerm);
            if (data.pathStart) setPathStart(data.pathStart);
            if (data.pathEnd) setPathEnd(data.pathEnd);
            if (data.isCompact !== undefined) setIsCompact(data.isCompact);
            if (data.isTimelineMode !== undefined) setIsTimelineMode(data.isTimelineMode);
            if (data.isTextOnly !== undefined) setIsTextOnly(data.isTextOnly);

            // Immediately restore all nodes and links without animation
            setNodes(savedNodes.map((n: any) => ({ ...n, isLoading: false })));
            setLinks(savedLinks);
            setSearchId(prev => prev + 1);
            setNotification({ message: `Graph "${name}" loaded!`, type: 'success' });

        } catch (e) {
            console.error("Failed to load graph", e);
            setError("Failed to load graph data.");
            setNotification({ message: "Error loading graph.", type: 'error' });
        }
    };

    const handleDeleteGraph = (name: string) => {
        setConfirmDialog({
            isOpen: true,
            message: `Are you sure you want to delete "${name}"?`,
            onConfirm: () => {
                localStorage.removeItem(`constellations_graph_${name}`);
                setSavedGraphs(prev => prev.filter(n => n !== name));
                setConfirmDialog(null);
                setNotification({ message: `Graph "${name}" deleted.`, type: 'success' });
            }
        });
    };

    if (!isKeyReady) {
        return (
            <div className="flex flex-col items-center justify-center w-screen h-screen bg-slate-900 text-white space-y-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    Constellations
                </h1>
                <button onClick={handleSelectKey} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105">
                    <Key size={20} className="inline mr-2" /> Select API Key
                </button>
            </div>
        );
    }

    return (
        <div className="relative w-screen h-screen bg-slate-900">
            <Graph
                nodes={nodes}
                links={links}
                onNodeClick={handleNodeClick}
                onViewportChange={handleViewportChange}
                width={dimensions.width}
                height={dimensions.height}
                isCompact={isCompact}
                isTimelineMode={isTimelineMode}
                isTextOnly={isTextOnly}
                searchId={searchId}
            />

            <ControlPanel
                searchMode={searchMode}
                setSearchMode={setSearchMode}
                exploreTerm={exploreTerm}
                setExploreTerm={setExploreTerm}
                pathStart={pathStart}
                setPathStart={setPathStart}
                pathEnd={pathEnd}
                setPathEnd={setPathEnd}
                onSearch={handleStartSearch}
                onPathSearch={handlePathSearch}
                onClear={handleClear}
                isProcessing={isProcessing}
                isCompact={isCompact}
                onToggleCompact={() => setIsCompact(!isCompact)}
                isTimelineMode={isTimelineMode}
                onToggleTimeline={() => setIsTimelineMode(!isTimelineMode)}
                isTextOnly={isTextOnly}
                onToggleTextOnly={() => setIsTextOnly(!isTextOnly)}
                onPrune={handlePrune}
                error={error}
                onSave={handleSaveGraph}
                onLoad={handleLoadGraph}
                onDeleteGraph={handleDeleteGraph}
                onImport={handleImport}
                savedGraphs={savedGraphs}
            />
            <Sidebar
                selectedNode={selectedNode}
                onClose={() => setSelectedNode(null)}
                onSetStart={(id) => { setPathStart(id); setSearchMode('connect'); }}
                onSetEnd={(id) => { setPathEnd(id); setSearchMode('connect'); }}
                onAddMore={handleExpandMore}
                onRecursiveDelete={handleRecursiveDelete}
                isProcessing={isProcessing}
            />

            {/* Notification Toast */}
            {notification && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-lg shadow-2xl border border-slate-700 z-50 flex items-center animate-fade-in-up">
                    <div className={`w-3 h-3 rounded-full mr-3 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="font-medium">{notification.message}</span>
                </div>
            )}

            {/* Confirmation Dialog */}
            {confirmDialog && confirmDialog.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-700 shadow-2xl max-w-sm w-full mx-4">
                        <h3 className="text-xl font-bold mb-3">Confirm Action</h3>
                        <p className="text-slate-300 mb-6">{confirmDialog.message}</p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmDialog(null)}
                                className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDialog.onConfirm}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors font-medium"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;