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
    // Use local cache server when running locally, regardless of env var
    const cacheBaseUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:4000'
        : ((import.meta as any).env?.VITE_CACHE_API_URL || "");

    const [graphData, setGraphData] = useState<{ nodes: GraphNode[], links: GraphLink[] }>({ nodes: [], links: [] });
    const { nodes, links } = graphData;
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [isCompact, setIsCompact] = useState(false);
    const [isTimelineMode, setIsTimelineMode] = useState(false);
    const [isTextOnly, setIsTextOnly] = useState(false);
    const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
    const [error, setError] = useState<string | null>(null);
    const [isKeyReady, setIsKeyReady] = useState(false);
    const nodesRef = useRef<GraphNode[]>([]);
    const cacheEnabled = !!cacheBaseUrl;

    // Search State Lifted
    const [searchMode, setSearchMode] = useState<'explore' | 'connect'>('explore');
    const [exploreTerm, setExploreTerm] = useState('');
    const [pathStart, setPathStart] = useState('');
    const [pathEnd, setPathEnd] = useState('');
    const [searchId, setSearchId] = useState(0);
    const [deletePreview, setDeletePreview] = useState<{ keepIds: number[], dropIds: number[] } | null>(null);
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

            // Migration check: if IDs are strings, this is an old-format graph.
            if (savedNodes.length > 0 && typeof savedNodes[0].id === 'string') {
                setNotification({ message: `Graph "${sourceLabel}" uses an old format and cannot be loaded.`, type: 'error' });
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
            setGraphData({
                nodes: savedNodes.map((n: any) => ({
                    ...n,
                    isLoading: false,
                    vx: 0,
                    vy: 0,
                    fx: null,
                    fy: null
                })),
                links: savedLinks
            });
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

    const saveCacheNodeMeta = useCallback(async (
        nodeId: number,
        meta: { imageUrl?: string | null, wikiSummary?: string | null },
        fallbackNode?: Partial<GraphNode> & { id: number; type?: string; title: string }
    ) => {
        if (!cacheEnabled) return;
        const node = nodesRef.current.find(n => n.id === nodeId) || fallbackNode;
        if (!node || !node.type) return;
        try {
            const metaToSend: any = {};
            const img = meta.imageUrl ?? (node as any).imageUrl;
            const wiki = meta.wikiSummary ?? (node as any).wikiSummary;
            if (img) metaToSend.imageUrl = img;
            if (wiki) metaToSend.wikiSummary = wiki;
            await fetch(new URL("/node", cacheBaseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: node.id,
                    title: node.title,
                    type: node.type,
                    description: node.description || "",
                    year: node.year ?? null,
                    meta: metaToSend,
                    wikipedia_id: node.wikipedia_id
                })
            });
        } catch (e) {
            console.warn("Cache node save failed", e);
        }
    }, [cacheEnabled, cacheBaseUrl]);

    const loadNodeImage = useCallback(async (nodeId: number, title: string, context?: string, fallbackNode?: Partial<GraphNode> & { id: number; type?: string; title: string }) => {
        if (isTextOnly) return;

        setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, fetchingImage: true } : n)
        }));
        const url = await fetchWikipediaImage(title, context);
        if (url) {
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, imageUrl: url, fetchingImage: false, imageChecked: true } : n)
            }));
            saveCacheNodeMeta(nodeId, { imageUrl: url }, fallbackNode);
        } else {
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, fetchingImage: false, imageChecked: true } : n)
            }));
        }
    }, [isTextOnly, saveCacheNodeMeta]);

    const handleClear = () => {
        setGraphData({ nodes: [], links: [] });
        setSelectedNode(null);
        // Do not clear search terms as per user request
        // setExploreTerm('');
        // setPathStart('');
        // setPathEnd('');
        setError(null);
    };

    const handleStartSearch = async (term: string, recursiveDepth = 0) => {
        setIsProcessing(true);
        setError(null);
        setSearchId(prev => prev + 1);

        try {
            // 1. Classify
            const { type, description: geminiDescription } = await classifyEntity(term);
            
            // 2. Get Wikipedia metadata
            const wiki = await fetchWikipediaSummary(term);
            
            // 3. Upsert to DB to get serial ID
            let nodeId: number = -1;
            if (cacheEnabled) {
                const res = await fetch(new URL("/node", cacheBaseUrl).toString(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: term.trim(),
                        type,
                        description: wiki.extract || geminiDescription || '',
                        wikipedia_id: wiki.pageid?.toString()
                    })
                });
                const data = await res.json();
                nodeId = data.id;
            }

            const startNode: GraphNode = {
                id: nodeId,
                title: term.trim(),
                type: type,
                wikipedia_id: wiki.pageid?.toString(),
                description: wiki.extract || geminiDescription || '',
                x: dimensions.width / 2,
                y: dimensions.height / 2,
                expanded: false,
                wikiSummary: wiki.extract || undefined
            };

            setGraphData({
                nodes: [startNode],
                links: []
            });
            setSelectedNode(startNode);
            loadNodeImage(startNode.id, startNode.title);

            await expandNode(startNode, true, false, [startNode], []);

            if (recursiveDepth > 0) {
                setNotification({ message: "Auto-expanding connections...", type: 'success' });
                await new Promise(resolve => setTimeout(resolve, 800));

                setGraphData(current => {
                    const neighbors = new Set<number>();
                    current.links.forEach(l => {
                        const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
                        const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
                        if (s === startNode.id) neighbors.add(t);
                        else if (t === startNode.id) neighbors.add(s);
                    });

                    neighbors.forEach(neighborId => {
                        const nodeToExpand = current.nodes.find(n => n.id === neighborId);
                        if (nodeToExpand && !nodeToExpand.expanded) {
                            expandNode(nodeToExpand);
                        }
                    });

                    return current;
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
        setGraphData({ nodes: [], links: [] });
        setSelectedNode(null);

        try {
            // 1. Classify and Upsert endpoints
            const [startC, endC] = await Promise.all([
                classifyEntity(start),
                classifyEntity(end)
            ]);
            
            const [startWiki, endWiki] = await Promise.all([
                fetchWikipediaSummary(start),
                fetchWikipediaSummary(end)
            ]);

            const upsertNode = async (title: string, type: string, description: string, wiki: any) => {
                if (!cacheEnabled) return { id: Math.random() };
                const res = await fetch(new URL("/node", cacheBaseUrl).toString(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: title.trim(),
                        type,
                        description: wiki.extract || description,
                        wikipedia_id: wiki.pageid?.toString()
                    })
                });
                return await res.json();
            };

            const [startNodeData, endNodeData] = await Promise.all([
                upsertNode(start, startC.type, startC.description || '', startWiki),
                upsertNode(end, endC.type, endC.description || '', endWiki)
            ]);

            const startNode: GraphNode = {
                id: startNodeData.id,
                title: start.trim(),
                type: startC.type,
                wikipedia_id: startWiki.pageid?.toString(),
                description: startWiki.extract || startC.description || 'Start of path discovery.',
                x: dimensions.width / 4,
                y: dimensions.height / 2,
                expanded: false
            };

            const endNode: GraphNode = {
                id: endNodeData.id,
                title: end.trim(),
                type: endC.type,
                wikipedia_id: endWiki.pageid?.toString(),
                description: endWiki.extract || endC.description || 'Destination of path discovery.',
                x: (dimensions.width / 4) * 3,
                y: dimensions.height / 2,
                expanded: false
            };

            setGraphData({
                nodes: [startNode, endNode],
                links: []
            });
            loadNodeImage(startNode.id, startNode.title);
            loadNodeImage(endNode.id, endNode.title);

            // 2. Expand both endpoints concurrently to show "work"
            setNotification({ message: `Exploring "${start}" and "${end}"...`, type: 'success' });

            await new Promise(resolve => setTimeout(resolve, 300));

            try {
                await Promise.all([
                    expandNode(startNode, true, false, [startNode, endNode], []).catch(e => console.warn("Start expansion failed", e)),
                    expandNode(endNode, true, false, [startNode, endNode], []).catch(e => console.warn("End expansion failed", e))
                ]);
            } catch (e) {
                console.warn("Endpoints expansion partially failed", e);
            }

            // 3. Fetch the path in background
            setNotification({ message: "Finding hidden connections...", type: 'success' });

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
                pathData = await fetchConnectionPath(start, end, {
                    startWiki: startWiki.extract || undefined,
                    endWiki: endWiki.extract || undefined
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
                
                // Get Wikipedia info for disambiguation and serial ID
                const stepWiki = await fetchWikipediaSummary(currentStep.id);
                const stepNodeData = await upsertNode(currentStep.id, currentStep.type, currentStep.description, stepWiki);
                const resolvedId = stepNodeData.id;

                setGraphData(current => {
                    const existing = current.nodes.find(n => n.id === resolvedId);
                    
                    const newNode: GraphNode = existing ? {
                        ...existing,
                        description: currentStep.description,
                        year: currentStep.year || existing.year,
                        expanded: existing.expanded
                    } : {
                        id: resolvedId,
                        title: currentStep.id,
                        type: currentStep.type,
                        wikipedia_id: stepWiki.pageid?.toString(),
                        description: currentStep.description,
                        year: currentStep.year,
                        x: (dimensions.width / 2) + (i - steps / 2) * 50,
                        y: (dimensions.height / 2) + Math.sin(i) * 50,
                        expanded: false
                    };

                    const updatedNodes = existing
                        ? current.nodes.map(n => n.id === existing.id ? newNode : n)
                        : [...current.nodes, newNode];

                    setSelectedNode(newNode);

                    const linkId = `${tailId}-${resolvedId}`;
                    const reverseLinkId = `${resolvedId}-${tailId}`;
                    const updatedLinks = current.links.some(l => l.id === linkId || l.id === reverseLinkId)
                        ? current.links
                        : [...current.links, {
                            source: tailId,
                            target: resolvedId,
                            id: linkId,
                            label: currentStep.justification || "Connected"
                        }];

                    loadNodeImage(resolvedId, newNode.title);
                    return { nodes: updatedNodes, links: updatedLinks };
                });

                // Trigger expansion on the intermediate node
                const nodeToExpand = nodesRef.current.find(n => n.id === resolvedId);
                if (nodeToExpand && !nodeToExpand.expanded) {
                    expandNode(nodeToExpand).catch(e => console.warn("Intermediate expansion failed", e));
                }

                currentTailId = resolvedId;
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
        const linkCounts = new Map<number, number>();
        links.forEach(l => {
            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
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
            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
            return nodeIdsToKeep.has(s) && nodeIdsToKeep.has(t);
        });

        setGraphData({
            nodes: nodesToKeep,
            links: linksToKeep
        });
    };

    const computeDeleteOutcome = useCallback((rootId: number) => {
        const remainingNodes = nodes.filter(n => n.id !== rootId);
        const remainingLinks = links.filter(l => {
            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
            return s !== rootId && t !== rootId;
        });

        if (remainingNodes.length === 0) {
            return {
                keepNodes: [] as GraphNode[],
                keepLinks: [] as GraphLink[],
                keepIds: [] as number[],
                dropIds: nodes.map(n => n.id)
            };
        }

        const adj = new Map<number, Set<number>>();
        remainingNodes.forEach(n => adj.set(n.id, new Set()));
        remainingLinks.forEach(l => {
            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
            if (adj.has(s) && adj.has(t)) {
                adj.get(s)!.add(t);
                adj.get(t)!.add(s);
            }
        });

        const visited = new Set<number>();
        const components: number[][] = [];

        for (const node of remainingNodes) {
            if (visited.has(node.id)) continue;
            const queue = [node.id];
            const comp: number[] = [];
            visited.add(node.id);
            while (queue.length) {
                const id = queue.shift() as number;
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
            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
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

    const expandNode = useCallback(async (node: GraphNode, isInitial = false, forceMore = false, nodesOverride?: GraphNode[], linksOverride?: GraphLink[]) => {
        const currentNodes = nodesOverride || nodes;
        const currentLinks = linksOverride || links;

        if (!forceMore && (node.expanded || node.isLoading)) return;

        setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: true } : n)
        }));
        setIsProcessing(true);
        setError(null);

        try {
            const nodeUpdates = new Map<number, Partial<GraphNode>>();

            // Cache lookup (exact) unless forceMore
            if (cacheEnabled && !forceMore) {
                const cacheHit = await fetchCacheExpansion(node.id);
                if (cacheHit && cacheHit.hit === "exact" && cacheHit.nodes) {
                    const cachedNodes: any[] = cacheHit.nodes;
                    setGraphData(prev => {
                        const nodeMap = new Map<number, GraphNode>(prev.nodes.map(n => [n.id, n]));
                        cachedNodes.forEach(cn => {
                            const meta = cn.meta || {};
                            const existing = nodeMap.get(cn.id);
                            const imageUrl = meta.imageUrl ?? existing?.imageUrl;

                            const initialX = node.x ? node.x + (Math.random() - 0.5) * 100 : undefined;
                            const initialY = node.y ? node.y + (Math.random() - 0.5) * 100 : undefined;

                            const merged: GraphNode = {
                                x: initialX,
                                y: initialY,
                                ...(existing || {}),
                                id: cn.id,
                                title: cn.title,
                                type: cn.type,
                                wikipedia_id: cn.wikipedia_id,
                                description: cn.description || existing?.description || "",
                                year: cn.year ?? existing?.year,
                                imageUrl,
                                wikiSummary: meta.wikiSummary ?? (existing as any)?.wikiSummary,
                                expanded: existing?.expanded || false,
                                isLoading: false
                            };
                            nodeMap.set(cn.id, merged);
                        });
                        if (nodeMap.has(node.id)) {
                            nodeMap.set(node.id, { ...nodeMap.get(node.id)!, expanded: true, isLoading: false });
                        }
                        const updatedNodes = Array.from(nodeMap.values());

                        const existingLinkIds = new Set(prev.links.map(l => l.id));
                        const newLinksToAdd: GraphLink[] = cachedNodes.map(cn => ({
                            source: node.id,
                            target: cn.id,
                            id: `${node.id}-${cn.id}`
                        })).filter(l => !existingLinkIds.has(l.id));
                        const updatedLinks = [...prev.links, ...newLinksToAdd];

                        return { nodes: updatedNodes, links: updatedLinks };
                    });

                    cachedNodes.forEach((cn, idx) => {
                        setTimeout(() => loadNodeImage(cn.id, cn.title), 200 * idx);
                    });
                    setIsProcessing(false);
                    return;
                }
            }

            // LLM fetch
            const neighborLinks = currentLinks.filter(l =>
                (typeof l.source === 'number' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                (typeof l.target === 'number' ? l.target === node.id : (l.target as GraphNode).id === node.id)
            );
            const neighborNames = neighborLinks.map(l => {
                const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
                const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
                const nid = s === node.id ? t : s;
                return currentNodes.find(n => n.id === nid)?.title || '';
            }).filter(Boolean);

            const wiki = await fetchWikipediaSummary(node.title, neighborNames.join(' '));
            if (wiki.extract) {
                nodeUpdates.set(node.id, { wikiSummary: wiki.extract, wikipedia_id: wiki.pageid?.toString() });
            }

            let results: any[] = [];
            if (node.type === 'Person') {
                const data = await fetchPersonWorks(node.title, neighborNames, wiki.extract || undefined);
                results = data.works.map(w => ({ title: w.entity, type: w.type, description: w.description, year: w.year, role: w.role }));
            } else {
                const data = await fetchConnections(node.title, undefined, neighborNames, wiki.extract || undefined);
                if (data.sourceYear) nodeUpdates.set(node.id, { year: data.sourceYear });
                results = data.people.map(p => ({ title: p.name, type: 'Person', description: p.description, role: p.role }));
            }

            if (results.length === 0) {
                if (isInitial) {
                    setError(`No connections found for "${node.title}".`);
                    setGraphData({ nodes: [], links: [] });
                    setSelectedNode(null);
                } else {
                    setGraphData(prev => ({
                        ...prev,
                        nodes: prev.nodes.map(n => n.id === node.id ? { ...n, expanded: true, isLoading: false } : n)
                    }));
                }
            } else {
                // Get Wikipedia info for all results to help disambiguate
                const resultsWithWiki = await Promise.all(results.map(async r => {
                    const rWiki = await fetchWikipediaSummary(r.title, node.title);
                    return { ...r, wikipedia_id: rWiki.pageid?.toString(), description: rWiki.extract || r.description };
                }));

                if (cacheEnabled) {
                    await saveCacheExpansion(node.id, resultsWithWiki);
                    // Re-fetch from cache to get serial IDs
                    const cacheHit = await fetchCacheExpansion(node.id);
                    if (cacheHit && cacheHit.nodes) {
                        const cachedNodes: any[] = cacheHit.nodes;
                        setGraphData(prev => {
                            const nodeMap = new Map<number, GraphNode>(prev.nodes.map(n => [n.id, n]));
                            cachedNodes.forEach(cn => {
                                const meta = cn.meta || {};
                                const existing = nodeMap.get(cn.id);
                                const merged: GraphNode = {
                                    id: cn.id,
                                    title: cn.title,
                                    type: cn.type,
                                    wikipedia_id: cn.wikipedia_id,
                                    description: cn.description || existing?.description || "",
                                    year: cn.year ?? existing?.year,
                                    imageUrl: meta.imageUrl ?? existing?.imageUrl,
                                    wikiSummary: meta.wikiSummary ?? (existing as any)?.wikiSummary,
                                    x: existing?.x ?? (node.x ? node.x + (Math.random() - 0.5) * 100 : undefined),
                                    y: existing?.y ?? (node.y ? node.y + (Math.random() - 0.5) * 100 : undefined),
                                    expanded: existing?.expanded || false,
                                    isLoading: false
                                };
                                nodeMap.set(cn.id, merged);
                            });
                            if (nodeMap.has(node.id)) {
                                nodeMap.set(node.id, { ...nodeMap.get(node.id)!, expanded: true, isLoading: false, ...nodeUpdates.get(node.id) });
                            }
                            const updatedNodes = Array.from(nodeMap.values());
                            const existingLinkIds = new Set(prev.links.map(l => l.id));
                            const newLinksToAdd: GraphLink[] = cachedNodes.map(cn => ({
                                source: node.id,
                                target: cn.id,
                                id: `${node.id}-${cn.id}`
                            })).filter(l => !existingLinkIds.has(l.id));
                            return { nodes: updatedNodes, links: [...prev.links, ...newLinksToAdd] };
                        });
                        cachedNodes.forEach((cn, idx) => {
                            setTimeout(() => loadNodeImage(cn.id, cn.title), 300 * (idx + 1));
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Failed to expand node", error);
            setError("Failed to fetch connections. The AI might be busy.");
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: false } : n)
            }));
        } finally {
            setIsProcessing(false);
        }
    }, [nodes, links, loadNodeImage, cacheEnabled, fetchCacheExpansion, saveCacheExpansion, cacheBaseUrl]);

    const handleExpandMore = (node: GraphNode) => {
        expandNode(node, false, true);
    };

    const handleSmartDelete = (rootId: number) => {
        const preview = computeDeleteOutcome(rootId);
        const node = nodes.find(n => n.id === rootId);
        const title = node?.title || rootId.toString();
        
        setDeletePreview({ keepIds: preview.keepIds, dropIds: preview.dropIds });

        setConfirmDialog({
            isOpen: true,
            message: `Are you sure you want to delete "${title}"? This will also prune any resulting orphaned connections.`,
            onConfirm: () => {
                const outcome = computeDeleteOutcome(rootId);

                setGraphData({
                    nodes: outcome.keepNodes,
                    links: outcome.keepLinks
                });
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
        const neighborIds = links.reduce<number[]>((acc, l) => {
            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
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
                setSelectedNode(targetNode);
                await expandNode(targetNode);
                // Delay to allow physics and state to settle
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
                console.warn(`Failed to expand node ${targetNode.id}`, e);
            }
        }
    }, [nodes, links, expandNode]);

    const handleNodeClick = (node: GraphNode | null) => {
        if (!node) {
            setSelectedNode(null);
            return;
        }

        // Retry image fetch if it failed previously
        if (node.imageChecked && !node.imageUrl) {
            loadNodeImage(node.id, node.title);
        }

        // If in connect mode, auto-fill start/end inputs ONLY if they are empty
        if (searchMode === 'connect') {
            if (!pathStart) {
                setPathStart(node.title);
            } else if (!pathEnd && node.title !== pathStart) {
                setPathEnd(node.title);
            }
        }

        setSelectedNode(prev => (prev?.id === node.id ? null : node));

        if (node && !node.expanded) {
            expandNode(node);
        }
    };

    const handleViewportChange = useCallback((visibleNodes: GraphNode[]) => {
        if (visibleNodes.length <= 15 && !isTextOnly) {
            visibleNodes.forEach((node, index) => {
                if (!node.imageUrl && !node.fetchingImage && !node.imageChecked) {
                    // Find neighbors for context to help disambiguate during image search
                    const neighborLinks = links.filter(l =>
                        (typeof l.source === 'number' ? l.source === node.id : (l.source as GraphNode).id === node.id) ||
                        (typeof l.target === 'number' ? l.target === node.id : (l.target as GraphNode).id === node.id)
                    );
                    const neighborTitles = neighborLinks.map(l => {
                        const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
                        const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
                        const nid = s === node.id ? t : s;
                        return nodesRef.current.find(n => n.id === nid)?.title || '';
                    }).filter(Boolean);
                    const context = neighborTitles.join(' ');

                    setTimeout(() => {
                        loadNodeImage(node.id, node.title, context);
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
    const fetchCacheExpansion = useCallback(async (sourceId: number) => {
        if (!cacheEnabled) return null;
        const url = new URL("/expansion", cacheBaseUrl);
        url.searchParams.set("sourceId", sourceId.toString());
        try {
            const res = await fetch(url.toString());
            if (!res.ok) return null;
            return res.json();
        } catch (e) {
            console.warn("Cache fetch failed", e);
            return null;
        }
    }, [cacheEnabled, cacheBaseUrl]);

    const saveCacheExpansion = useCallback(async (sourceId: number, nodesToSave: any[]) => {
        if (!cacheEnabled) return;
        try {
            await fetch(new URL("/expansion", cacheBaseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sourceId,
                    nodes: nodesToSave.map(n => ({
                        title: n.title || n.id,
                        type: n.type,
                        description: n.description || "",
                        year: n.year || null,
                        meta: n.meta || {},
                        wikipedia_id: n.wikipedia_id
                    }))
                })
            });
        } catch (e) {
            console.warn("Cache save failed", e);
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
