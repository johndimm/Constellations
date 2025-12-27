import React, { useState, useEffect, useCallback, useRef } from 'react';
import Graph from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import { GraphNode, GraphLink } from './types';
import { fetchConnections, fetchPersonWorks, classifyEntity, fetchConnectionPath } from './services/geminiService';
import { fetchWikipediaImage, fetchWikipediaSummary } from './services/wikipediaService';
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
    const cacheBaseUrl = (import.meta as any).env?.VITE_CACHE_API_URL || "";

    const computeContextFingerprint = async (context: string[]): Promise<string> => {
        const sorted = [...context].sort();
        const joined = sorted.join("|");
        if (window.crypto?.subtle) {
            const data = new TextEncoder().encode(joined);
            const digest = await window.crypto.subtle.digest("SHA-1", data);
            return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
        }
        // Fallback non-crypto hash
        let hash = 0;
        for (let i = 0; i < joined.length; i++) {
            hash = ((hash << 5) - hash + joined.charCodeAt(i)) | 0;
        }
        return `fallback-${Math.abs(hash)}`;
    };

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
    const nodesRef = useRef<GraphNode[]>([]);

    // Search State Lifted
    const [searchMode, setSearchMode] = useState<'explore' | 'connect'>('explore');
    const [exploreTerm, setExploreTerm] = useState('');
    const [pathStart, setPathStart] = useState('');
    const [pathEnd, setPathEnd] = useState('');
    const [searchId, setSearchId] = useState(0);
    const [deletePreview, setDeletePreview] = useState<{ keepIds: string[], dropIds: string[] } | null>(null);
    const [helpHover, setHelpHover] = useState<string | null>(null);

    // Keep selectedNode in sync with latest node data (e.g., wikiSummary, images)
    useEffect(() => {
        if (!selectedNode) return;
        const updated = nodes.find(n => n.id === selectedNode.id);
        if (updated && updated !== selectedNode) {
            setSelectedNode(updated);
        }
    }, [nodes, selectedNode]);

    // Centralized apply-graph helper to reuse for imports/localStorage/public graphs
    const applyGraphData = useCallback((data: any, sourceLabel: string) => {
        try {
            const savedNodes = data.nodes || [];
            const savedLinks = data.links || [];

            if (savedNodes.length === 0) {
                setNotification({ message: `Graph "${sourceLabel}" is empty.`, type: 'error' });
                return;
            }

            if (data.searchMode) setSearchMode(data.searchMode);
            if (data.exploreTerm) setExploreTerm(data.exploreTerm);
            if (data.pathStart) setPathStart(data.pathStart);
            if (data.pathEnd) setPathEnd(data.pathEnd);
            if (data.isCompact !== undefined) setIsCompact(data.isCompact);
            if (data.isTimelineMode !== undefined) setIsTimelineMode(data.isTimelineMode);
            if (data.isTextOnly !== undefined) setIsTextOnly(data.isTextOnly);

            // Strip any residual forces/drag so pre-bundled graphs don't keep spinning
            setNodes(savedNodes.map((n: any) => ({
                ...n,
                isLoading: false,
                vx: 0,
                vy: 0,
                fx: null,
                fy: null
            })));
            setLinks(savedLinks);
            setSearchId(prev => prev + 1);
            setError(null);
            setNotification({ message: `Graph "${sourceLabel}" loaded!`, type: 'success' });
        } catch (e) {
            console.error("Failed to apply graph data", e);
            setError("Failed to load graph data.");
            setNotification({ message: "Error loading graph.", type: 'error' });
        }
    }, []);

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

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    const loadNodeImage = useCallback(async (nodeId: string, context?: string) => {
        if (isTextOnly) return;

        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: true } : n));
        const url = await fetchWikipediaImage(nodeId, context);
        if (url) {
            setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: url, fetchingImage: false, imageChecked: true } : n));
            saveCacheNodeMeta(nodeId, { imageUrl: url });
        } else {
            setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: false, imageChecked: true } : n));
        }
    }, [isTextOnly, saveCacheNodeMeta]);

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
            // Determine if it's a Person or a Thing (Event/Movie/etc) and get description
            const { type, description } = await classifyEntity(term);

            const startNode: GraphNode = {
                id: term.trim(),
                type: type,
                description: description || '',
                x: dimensions.width / 2,
                y: dimensions.height / 2,
                expanded: false
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
            const [startClassification, endClassification] = await Promise.all([
                classifyEntity(start),
                classifyEntity(end)
            ]);

            const startNode: GraphNode = {
                id: start.trim(),
                type: startClassification.type,
                description: startClassification.description || 'Start of path discovery.',
                x: dimensions.width / 4,
                y: dimensions.height / 2,
                expanded: false
            };

            const endNode: GraphNode = {
                id: end.trim(),
                type: endClassification.type,
                description: endClassification.description || 'Destination of path discovery.',
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
            const [startWiki, endWiki] = await Promise.all([
                fetchWikipediaSummary(start, end),
                fetchWikipediaSummary(end, start)
            ]);
                
                pathData = await fetchConnectionPath(start, end, {
                    startWiki: startWiki || undefined,
                    endWiki: endWiki || undefined
                });
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

    // Load initial graph based on URL params (static or live)
    useEffect(() => {
        const checkParams = async () => {
            const params = new URLSearchParams(window.location.search);
            const graphName = params.get('graph');
            const query = params.get('q');
            const start = params.get('start');
            const end = params.get('end');

            // If a static graph is requested, prefer loading that over live queries
            if (graphName && isKeyReady) {
                try {
                    const res = await fetch(`/graphs/${graphName}.json`);
                    if (!res.ok) throw new Error(`Graph file not found: ${graphName}.json`);
                    const data = await res.json();
                    applyGraphData(data, graphName);
                    return;
                } catch (err) {
                    console.error("Failed to load public graph", err);
                    setNotification({ message: `Could not load graph "${graphName}".`, type: 'error' });
                    // Fall through to other params if provided
                }
            }

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
        // handleStartSearch/handlePathSearch are stable enough for initial load; avoid reruns on every render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isKeyReady, applyGraphData]);

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

    const computeDeleteOutcome = useCallback((rootId: string) => {
        const remainingNodes = nodes.filter(n => n.id !== rootId);
        const remainingLinks = links.filter(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            return s !== rootId && t !== rootId;
        });

        if (remainingNodes.length === 0) {
            return {
                keepNodes: [] as GraphNode[],
                keepLinks: [] as GraphLink[],
                keepIds: [] as string[],
                dropIds: nodes.map(n => n.id)
            };
        }

        const adj = new Map<string, Set<string>>();
        remainingNodes.forEach(n => adj.set(n.id, new Set()));
        remainingLinks.forEach(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            if (adj.has(s) && adj.has(t)) {
                adj.get(s)!.add(t);
                adj.get(t)!.add(s);
            }
        });

        const visited = new Set<string>();
        const components: string[][] = [];

        for (const node of remainingNodes) {
            if (visited.has(node.id)) continue;
            const queue = [node.id];
            const comp: string[] = [];
            visited.add(node.id);
            while (queue.length) {
                const id = queue.shift() as string;
                comp.push(id);
                const neighbors = adj.get(id);
                if (!neighbors) continue;
                neighbors.forEach(nb => {
                    if (!visited.has(nb)) {
                        visited.add(nb);
                        queue.push(nb);
                    }
                });
            }
            components.push(comp);
        }

        let largest = components[0] || [];
        for (const comp of components) {
            if (comp.length > largest.length) largest = comp;
        }
        const keepIdsSet = new Set(largest);

        const keepNodes = remainingNodes.filter(n => keepIdsSet.has(n.id));
        const keepLinks = remainingLinks.filter(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            return keepIdsSet.has(s) && keepIdsSet.has(t);
        });

        const dropIds = nodes
            .map(n => n.id)
            .filter(id => id === rootId || !keepIdsSet.has(id));

        return {
            keepNodes,
            keepLinks,
            keepIds: Array.from(keepIdsSet),
            dropIds
        };
    }, [nodes, links]);

    const expandNode = useCallback(async (node: GraphNode, isInitial = false, forceMore = false) => {
        if (!forceMore && (node.expanded || node.isLoading)) return;

        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: true } : n));
        setIsProcessing(true);
        setError(null);

        try {
            let newNodes: GraphNode[] = [];
            let newLinks: GraphLink[] = [];
            const nodeUpdates = new Map<string, Partial<GraphNode>>();
            const targetsCollected: string[] = [];

            // Build context used in prompt (for cache key)
            let contextForCache: string[] = [];
            if (node.type === 'Person') {
                const neighborLinks = links.filter(l =>
                    (typeof l.source === 'string' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                    (typeof l.target === 'string' ? l.target === node.id : (l.target as GraphNode).id === node.id)
                );
                contextForCache = neighborLinks.map(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                    return s === node.id ? t : s;
                });
            } else {
                const nodeNeighbors = links.filter(l =>
                    (typeof l.source === 'string' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                    (typeof l.target === 'string' ? l.target === node.id : (l.target as GraphNode).id === node.id)
                );
                contextForCache = nodeNeighbors.map(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                    return s === node.id ? t : s;
                });
            }

            // Cache lookup (exact, then partial) unless forceMore
            if (cacheEnabled && !forceMore) {
                const cacheHit = await fetchCacheExpansion(node.id, contextForCache);
                if (cacheHit && cacheHit.hit && cacheHit.targets && cacheHit.nodes) {
                    const targets: string[] = cacheHit.targets;
                    const cachedNodes: any[] = cacheHit.nodes;
                    setNodes(prev => {
                        const map = new Map<string, GraphNode>(prev.map(n => [n.id, n]));
                        cachedNodes.forEach(cn => {
                            const meta = cn.meta || {};
                            const existing = map.get(cn.id);
                            const merged: GraphNode = {
                                ...(existing || {}),
                                id: cn.id,
                                type: cn.type,
                                description: cn.description || existing?.description || "",
                                year: cn.year ?? existing?.year,
                                imageUrl: meta.imageUrl ?? existing?.imageUrl,
                                // @ts-ignore
                                wikiSummary: meta.wikiSummary ?? (existing as any)?.wikiSummary,
                                expanded: existing?.expanded || false,
                                isLoading: false
                            };
                            map.set(cn.id, merged);
                        });
                        if (map.has(node.id)) {
                            map.set(node.id, { ...map.get(node.id)!, expanded: true, isLoading: false });
                        }
                        return Array.from(map.values());
                    });
                    setLinks(prev => {
                        const existingIds = new Set(prev.map(l => l.id));
                        const cacheLinks: GraphLink[] = targets.map(tid => ({
                            source: node.id,
                            target: tid,
                            id: `${node.id}-${tid}`
                        }));
                        const newOnes = cacheLinks.filter(l => !existingIds.has(l.id));
                        return [...prev, ...newOnes];
                    });
                    setIsProcessing(false);
                    return;
                }
            }

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

                // Fetch Wikipedia summary to improve Gemini's accuracy
                const wikiSummary = await fetchWikipediaSummary(node.id, neighborNames.join(' '));
                if (wikiSummary) {
                    nodeUpdates.set(node.id, { wikiSummary });
                }

                const data = await fetchPersonWorks(node.id, neighborNames, wikiSummary || undefined);

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
                            expanded: false
                        };
                        newNodes.push(newNode);
                    } else {
                        if (existingNode && !existingNode.year && work.year) {
                            nodeUpdates.set(existingNode.id, { year: work.year });
                        }
                    }
                    if (!targetsCollected.includes(resolvedId)) targetsCollected.push(resolvedId);

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

                // Fetch Wikipedia summary to improve Gemini's accuracy for new shows/events
                const wikiSummary = await fetchWikipediaSummary(node.id, context);
                if (wikiSummary) {
                    nodeUpdates.set(node.id, { wikiSummary });
                }

                const data = await fetchConnections(node.id, context, neighborIds, wikiSummary || undefined);

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
                        const existing = nodeUpdates.get(node.id) || {};
                        nodeUpdates.set(node.id, { ...existing, isLoading: false, expanded: true });
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
                        if (!targetsCollected.includes(resolvedId)) targetsCollected.push(resolvedId);

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

            // Persist expansion to cache (overwrite for this context)
            // Build cache payload including existing nodes touched
            const targetSet = new Set<string>(targetsCollected);
            const cacheNodesPayload: any[] = [];
            const findNode = (id: string) => newNodes.find(n => n.id === id) || nodes.find(n => n.id === id);
            targetSet.forEach(id => {
                const found = findNode(id);
                if (found) {
                    cacheNodesPayload.push({
                        id: found.id,
                        type: found.type,
                        description: found.description || "",
                        year: found.year ?? null,
                        meta: {
                            imageUrl: found.imageUrl ?? null,
                            // @ts-ignore
                            wikiSummary: (found as any)?.wikiSummary ?? null
                        }
                    });
                }
            });
            cacheNodesPayload.push({
                id: node.id,
                type: node.type,
                description: nodeUpdates.get(node.id)?.description ?? node.description ?? "",
                year: nodeUpdates.get(node.id)?.year ?? node.year,
                meta: {
                    imageUrl: node.imageUrl ?? null,
                    // @ts-ignore
                    wikiSummary: nodeUpdates.get(node.id)?.wikiSummary ?? (node as any)?.wikiSummary ?? null
                }
            });
            saveCacheExpansion(node.id, contextForCache, Array.from(targetSet), cacheNodesPayload as any);

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

    const handleSmartDelete = (rootId: string) => {
        const preview = computeDeleteOutcome(rootId);
        setDeletePreview({ keepIds: preview.keepIds, dropIds: preview.dropIds });

        setConfirmDialog({
            isOpen: true,
            message: `Are you sure you want to delete "${rootId}"? This will also prune any resulting orphaned connections.`,
            onConfirm: () => {
                const outcome = computeDeleteOutcome(rootId);

                setNodes(outcome.keepNodes);
                setLinks(outcome.keepLinks);
                setSelectedNode(null);
                setConfirmDialog(null);
                setDeletePreview(null);

                if (outcome.keepNodes.length === 0) {
                    setNotification({ message: `Node removed. Graph is now empty.`, type: 'success' });
                } else {
                    setNotification({ message: `Node removed. Kept largest connected component.`, type: 'success' });
                }
            }
        });
    };

    const handleExpandLeaves = useCallback(async (node: GraphNode) => {
        // Only expand direct neighbors of the selected node
        const neighborIds = links.reduce<string[]>((acc, l) => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
            if (s === node.id) acc.push(t);
            else if (t === node.id) acc.push(s);
            return acc;
        }, []);

        const neighbors = nodes.filter(n => neighborIds.includes(n.id) && !n.expanded && !n.isLoading);

        if (neighbors.length === 0) {
            setNotification({ message: "No unexpanded neighbors.", type: 'error' });
            return;
        }

        setNotification({ message: `Expanding ${neighbors.length} neighbors...`, type: 'success' });

        for (const targetNode of neighbors) {
            try {
                await expandNode(targetNode);
                // Delay to allow physics and state to settle
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
                console.warn(`Failed to expand node ${targetNode.id}`, e);
            }
        }
    }, [nodes, links, expandNode]);

    const handleNodeClick = (node: GraphNode) => {
        // Retry image fetch if it failed previously
        if (node.imageChecked && !node.imageUrl) {
            loadNodeImage(node.id);
        }

        // If in connect mode, auto-fill start/end inputs ONLY if they are empty
        if (searchMode === 'connect') {
            if (!pathStart) {
                setPathStart(node.id);
            } else if (!pathEnd && node.id !== pathStart) {
                setPathEnd(node.id);
            }
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
                    // Find neighbors for context to help disambiguate during image search
                    const neighborLinks = links.filter(l =>
                        (typeof l.source === 'string' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                        (typeof l.target === 'string' ? l.target === node.id : (l.target as GraphNode).id === node.id)
                    );
                    const neighborNames = neighborLinks.map(l => {
                        const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                        const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                        return s === node.id ? t : s;
                    });
                    const context = neighborNames.join(' ');

                    setTimeout(() => {
                        loadNodeImage(node.id, context);
                    }, 200 * index);
                }
            });
        }
    }, [loadNodeImage, isTextOnly, links]);

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
    const cacheEnabled = !!cacheBaseUrl;

    const fetchCacheExpansion = useCallback(async (sourceId: string, context: string[], minSimilarity = 0.5) => {
        if (!cacheEnabled) return null;
        const contextHash = await computeContextFingerprint(context);
        const url = new URL("/expansion", cacheBaseUrl);
        url.searchParams.set("sourceId", sourceId);
        url.searchParams.set("contextHash", contextHash);
        url.searchParams.set("context", [...context].sort().join(","));
        url.searchParams.set("minSimilarity", String(minSimilarity));
        try {
            const res = await fetch(url.toString());
            if (!res.ok) return null;
            return res.json();
        } catch (e) {
            console.warn("Cache fetch failed", e);
            return null;
        }
    }, [cacheEnabled, cacheBaseUrl, computeContextFingerprint]);

    const saveCacheExpansion = useCallback(async (sourceId: string, context: string[], targets: string[], nodesToSave: any[]) => {
        if (!cacheEnabled) return;
        try {
            await fetch(new URL("/expansion", cacheBaseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sourceId,
                    context,
                    targets,
                    nodes: nodesToSave.map(n => ({
                        id: n.id,
                        type: n.type,
                        description: n.description || "",
                        year: n.year || null,
                        meta: {
                            imageUrl: n.imageUrl || null,
                            wikiSummary: (n as any).wikiSummary || null
                        }
                    }))
                })
            });
        } catch (e) {
            console.warn("Cache save failed", e);
        }
    }, [cacheEnabled, cacheBaseUrl]);

    const saveCacheNodeMeta = useCallback(async (nodeId: string, meta: { imageUrl?: string | null, wikiSummary?: string | null }) => {
        if (!cacheEnabled) return;
        const node = nodesRef.current.find(n => n.id === nodeId);
        if (!node) return;
        try {
            await fetch(new URL("/node", cacheBaseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: node.id,
                    type: node.type,
                    description: node.description || "",
                    year: node.year ?? null,
                    meta: {
                        imageUrl: meta.imageUrl ?? node.imageUrl ?? null,
                        wikiSummary: meta.wikiSummary ?? (node as any).wikiSummary ?? null
                    }
                })
            });
        } catch (e) {
            console.warn("Cache node save failed", e);
        }
    }, [cacheEnabled, cacheBaseUrl]);

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
        if (!data.nodes || !data.links) {
            setNotification({ message: "Invalid graph JSON.", type: 'error' });
            return;
        }
        applyGraphData(data, "Imported graph");
    };

    const handleLoadGraph = (name: string) => {
        const dataStr = localStorage.getItem(`constellations_graph_${name}`);
        if (!dataStr) return;

        try {
            const data = JSON.parse(dataStr);
            applyGraphData(data, name);
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
                selectedNode={selectedNode}
                highlightKeepIds={deletePreview?.keepIds}
                highlightDropIds={deletePreview?.dropIds}
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
                helpHover={helpHover}
                onHelpHoverChange={setHelpHover}
            />
            <Sidebar
                selectedNode={selectedNode}
                onClose={() => setSelectedNode(null)}

                onAddMore={handleExpandMore}
            onExpandLeaves={handleExpandLeaves}
            onSmartDelete={handleSmartDelete}
            isProcessing={isProcessing}
            helpHover={helpHover}
        />

            {/* Notification Toast */}
            {notification && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-lg shadow-2xl border border-slate-700 z-50 flex items-center animate-fade-in-up">
                    <div className={`w-3 h-3 rounded-full mr-3 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="font-medium">{notification.message}</span>
                </div>
            )}

            {/* Confirmation Dialog (no blackout, small floating card) */}
            {confirmDialog && confirmDialog.isOpen && (
                <div className="fixed z-50 left-1/2 -translate-x-1/2 bottom-6">
                    <div className="bg-slate-900/95 text-white px-5 py-4 rounded-xl border border-slate-700 shadow-2xl max-w-sm w-[92vw]">
                        <h3 className="text-sm font-bold mb-2">Confirm delete</h3>
                        <p className="text-xs text-slate-300 mb-4">{confirmDialog.message}</p>
                        <div className="flex justify-end gap-3 text-sm">
                            <button
                                onClick={() => { setConfirmDialog(null); setDeletePreview(null); }}
                                className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDialog.onConfirm}
                                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors font-semibold"
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
