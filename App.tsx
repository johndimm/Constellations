import React, { useState, useEffect, useCallback, useRef } from 'react';
import Graph, { GraphHandle } from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import NodeContextMenu from './components/NodeContextMenu';
import { GraphNode, GraphLink } from './types';
import { fetchConnections, fetchPersonWorks, classifyEntity, fetchConnectionPath } from './services/geminiService';
import { getApiKey } from './services/aiUtils';
import { fetchWikipediaImage, fetchWikipediaSummary } from './services/wikipediaService';
import { Key, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

// Normalize string for deduplication: lower case, remove 'the ', remove punctuation
const normalizeForDedup = (str: string) => {
    return str.trim().toLowerCase()
        .replace(/^the\s+/i, '') // Remove leading "The "
        .replace(/[^\w\s]/g, '') // Remove punctuation like quotes/dots
        .replace(/\s+/g, ' ');   // Collapse spaces
};

const canonicalType = (t?: string) => {
    const norm = (t || '').trim().toLowerCase();
    if (!norm) return '';
    if (['film', 'movie', 'film series'].includes(norm) || norm.startsWith('film ')) return 'movie';
    if (norm === 'tv show' || norm === 'tv series' || norm === 'television series') return 'tv';
    return norm;
};

const dedupeKey = (title: string, type?: string, wikipediaId?: string | null) => {
    const normType = canonicalType(type);
    // Always use normalized title for case-insensitive deduplication
    // If wikipedia_id exists, include it as additional info, but still dedupe by normalized title
    const normTitle = normalizeForDedup(title);
    if (wikipediaId) return `wiki|${wikipediaId}|${normTitle}|${normType}`;
    return `${normTitle}|${normType}`;
};

// Helper to get base dedupe key (normalized title + type, ignoring wikipedia_id)
const baseDedupeKey = (title: string, type?: string) => {
    const normType = canonicalType(type);
    const normTitle = normalizeForDedup(title);
    return `${normTitle}|${normType}`;
};

// Merge duplicate nodes (same normalized title/type) and remap links accordingly.
const dedupeGraph = (
    nodes: GraphNode[],
    links: GraphLink[]
): { nodes: GraphNode[]; links: GraphLink[] } => {
    // Use base key (normalized title + type) for deduplication, regardless of wikipedia_id
    const dedupMap = new Map<string, GraphNode>();
    const idRemap = new Map<number, number>();

    const normalizeType = (t?: string) => {
        return (t || '').trim().toLowerCase();
    };

    const mergeType = (a?: string, b?: string) => {
        const na = normalizeType(a);
        const nb = normalizeType(b);
        if (na === 'person') return a;
        if (nb === 'person') return b;
        return a || b;
    };

    const mergeNode = (existing: GraphNode, incoming: GraphNode): GraphNode => {
        // Prefer node with wikipedia_id for base properties (title, wikipedia_id)
        const prefer = existing.wikipedia_id ? existing : incoming;
        return {
            ...prefer,
            type: mergeType(existing.type, incoming.type),
            imageUrl: existing.imageUrl || incoming.imageUrl || undefined,
            imageChecked: existing.imageChecked || incoming.imageChecked || !!existing.imageUrl || !!incoming.imageUrl,
            wikiSummary: existing.wikiSummary || incoming.wikiSummary || undefined,
            description: (existing.description && existing.description.length >= (incoming.description || '').length)
                ? existing.description
                : incoming.description,
            year: existing.year ?? incoming.year,
            expanded: existing.expanded || incoming.expanded,
            isLoading: existing.isLoading || incoming.isLoading,
            // Keep wikipedia_id from whichever node has it (already in prefer spread, but explicit for clarity)
            wikipedia_id: existing.wikipedia_id || incoming.wikipedia_id || undefined
        };
    };

    nodes.forEach(n => {
        // Use base key (normalized title + type) for case-insensitive deduplication
        const key = baseDedupeKey(n.title, n.type);
        const existing = dedupMap.get(key);
        if (!existing) {
            dedupMap.set(key, n);
            idRemap.set(n.id, n.id);
        } else {
            const merged = mergeNode(existing, n);
            dedupMap.set(key, merged);
            idRemap.set(n.id, merged.id);
            idRemap.set(existing.id, merged.id);
        }
    });

    const nodesOut = Array.from(dedupMap.values());

    const remapId = (value: number | GraphNode) => {
        const id = typeof value === 'number' ? value : value.id;
        return idRemap.get(id) ?? id;
    };

    const linkSeen = new Set<string>();
    const linksOut: GraphLink[] = [];
    links.forEach(l => {
        const s = remapId(l.source);
        const t = remapId(l.target);
        if (s === t) return; // drop self-links after remap
        const lid = `${s}-${t}`;
        if (linkSeen.has(lid)) return;
        linkSeen.add(lid);
        linksOut.push({
            ...l,
            source: s,
            target: t,
            id: lid
        });
    });

    return { nodes: nodesOut, links: linksOut };
};

const getEnvCacheUrl = () => {
    let url = "";
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            // @ts-ignore
            url = import.meta.env.VITE_CACHE_API_URL || "";
        }
    } catch (e) { }
    if (url) return url;
    try {
        if (typeof process !== 'undefined' && process.env) {
            url = process.env.VITE_CACHE_API_URL || "";
        }
    } catch (e) { }
    return url;
};

const App: React.FC = () => {
    // Use local cache server when running locally, regardless of env var
    const envCacheUrl = getEnvCacheUrl();
    const cacheBaseUrl = envCacheUrl ||
        (window.location.hostname === 'localhost' ? 'http://localhost:4000' : "");

    useEffect(() => {
        console.log(`🌐 Cache Base URL: "${cacheBaseUrl}" (Source: ${envCacheUrl ? 'env' : 'default'})`);
    }, [cacheBaseUrl, envCacheUrl]);

    const [graphData, setGraphData] = useState<{ nodes: GraphNode[], links: GraphLink[] }>({ nodes: [], links: [] });
    const { nodes, links } = graphData;
    const graphDataRef = useRef(graphData);
    graphDataRef.current = graphData;
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [isCompact, setIsCompact] = useState(false);
    const [isTimelineMode, setIsTimelineMode] = useState(false);
    const [isTextOnly, setIsTextOnly] = useState(false);
    const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
    const [error, setError] = useState<string | null>(null);
    const [isKeyReady, setIsKeyReady] = useState(false);
    const nodesRef = useRef<GraphNode[]>([]);
    const graphRef = useRef<GraphHandle>(null);
    const cacheEnabled = !!cacheBaseUrl;

    // Search State Lifted
    const [searchMode, setSearchMode] = useState<'explore' | 'connect'>('explore');
    const [exploreTerm, setExploreTerm] = useState('');
    const [pathStart, setPathStart] = useState('');
    const [pathEnd, setPathEnd] = useState('');
    const [searchId, setSearchId] = useState(0);
    const [deletePreview, setDeletePreview] = useState<{ keepIds: number[], dropIds: number[] } | null>(null);
    const [pathNodeIds, setPathNodeIds] = useState<number[]>([]);
    const [helpHover, setHelpHover] = useState<string | null>(null);
    const [pendingAutoExpandId, setPendingAutoExpandId] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
    const [panelCollapsed, setPanelCollapsed] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarToggleSignal, setSidebarToggleSignal] = useState(0);

    // Keep selectedNode in sync with latest node data (e.g., wikiSummary, images)
    useEffect(() => {
        if (!selectedNode) return;
        const updated = nodes.find(n => n.id === selectedNode.id);
        if (updated && updated !== selectedNode) {
            setSelectedNode(updated);
        }
    }, [nodes, selectedNode]);

    // Global safety net: dedupe graph whenever nodes/links change to eliminate stray duplicates
    useEffect(() => {
        const deduped = dedupeGraph(nodes, links);
        const nodesChanged = deduped.nodes.length !== nodes.length || deduped.nodes.some((n, i) => n.id !== nodes[i]?.id);
        const linksChanged = deduped.links.length !== links.length || deduped.links.some((l, i) => l.id !== links[i]?.id);
        if (nodesChanged || linksChanged) {
            setGraphData(deduped);
        }
    }, [nodes, links]);

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
            const envKey = await getApiKey();
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
        meta: { imageUrl?: string | null, wikiSummary?: string | null, wikipedia_id?: string | null },
        fallbackNode?: Partial<GraphNode> & { id: number; type?: string; title: string }
    ) => {
        if (!cacheEnabled) return;
        const node = nodesRef.current.find(n => n.id === nodeId) || fallbackNode;
        if (!node || !node.type) return;
        try {
            const metaToSend: any = {};
            const img = meta.imageUrl ?? (node as any).imageUrl;
            const wiki = meta.wikiSummary ?? (node as any).wikiSummary;
            const wikiId = meta.wikipedia_id ?? (node as any).wikipedia_id;
            if (img) metaToSend.imageUrl = img;
            if (wiki) metaToSend.wikiSummary = wiki;
            if (wikiId) metaToSend.wikipedia_id = wikiId;
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
                    wikipedia_id: wikiId || node.wikipedia_id
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
        setPathNodeIds([]); // Clear path highlighting
    };

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

    const fetchAndExpandNode = useCallback(async (node: GraphNode, isInitial = false, forceMore = false, nodesOverride?: GraphNode[], linksOverride?: GraphLink[]) => {
        const currentNodes = nodesOverride || nodes;
        const currentLinks = linksOverride || links;

        if (!forceMore && (node.expanded || node.isLoading)) return;

        console.log(
            `🚀 [UI] expand request`,
            { id: node.id, title: node.title, type: node.type, forceMore, isInitial }
        );

        setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: true } : n)
        }));
        // Prevent repeated requests for the same node while a fetch is in flight
        // by marking its image as checked during this operation.
        const markChecked = () => setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => n.id === node.id ? { ...n, imageChecked: true } : n)
        }));
        markChecked();
        const loadingGuard = setTimeout(() => {
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: true } : n)
            }));
        }, 0);
        setIsProcessing(true);
        setError(null);

        try {
            const nodeUpdates = new Map<number, Partial<GraphNode>>();

            const fixMissingWiki = (targets: any[]) => {
                targets.forEach((cn, idx) => {
                    const hasWikiId = !!(cn.wikipedia_id && String(cn.wikipedia_id).trim());
                    const hasSummary = !!(cn.meta?.wikiSummary || cn.wikiSummary);
                    if (hasWikiId || hasSummary) return;
                    setTimeout(async () => {
                        try {
                            // Mark as checked to avoid repeated attempts this session
                            setGraphData(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => n.id === cn.id ? { ...n, wikiChecked: true } : n)
                            }));

                            const wiki = await fetchWikipediaSummary(cn.title);
                            if (!wiki.extract && !wiki.pageid) return;
                            setGraphData(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => {
                                    if (n.id !== cn.id) return n;
                                    return {
                                        ...n,
                                        wikiSummary: wiki.extract || n.wikiSummary,
                                        wikipedia_id: wiki.pageid ? wiki.pageid.toString() : n.wikipedia_id
                                    };
                                })
                            }));
                            saveCacheNodeMeta(
                                cn.id,
                                { wikiSummary: wiki.extract || null, wikipedia_id: wiki.pageid ? wiki.pageid.toString() : null },
                                { id: cn.id, title: cn.title, type: cn.type }
                            );
                        } catch (e) {
                            console.warn("Wiki fixup failed for", cn.title, e);
                        }
                    }, 50 * idx);
                });
            };

            // Cache lookup (exact) unless forceMore
            if (cacheEnabled && !forceMore) {
                const cacheHit = await fetchCacheExpansion(node.id);
                if (cacheHit && cacheHit.hit === "exact" && cacheHit.nodes) {
                    console.log(`💾 [Cache] exact expansion hit for node ${node.id} (${node.title}), targets=${cacheHit.nodes.length}`);
                    const cachedNodes: any[] = cacheHit.nodes;
                    const validCached = cachedNodes.filter(cn => cn.id !== node.id); // ignore self

                    if (validCached.length === 0) {
                        console.log(`💾 [Cache] hit but contained no valid targets. Falling back to LLM.`);
                        // Fall through to LLM logic below
                    } else {
                        // Pre-calculate new items using the ref to avoid stale state in simple functional updates
                        const currentNodes = nodesRef.current;
                        const existingNodeIds = new Set(currentNodes.map(n => n.id));
                        const newNodesCount = validCached.filter(cn => !existingNodeIds.has(cn.id)).length;

                        // Check for new links too (using current links in scope)
                        // Note: links might be slightly stale but dedupe handles duplicates safely.
                        // We primarily want to avoid blocking valid link creation.
                        // Use undirected canonical keys to avoid counting back-links as "new"
                        const getLinkKey = (a: number | string, b: number | string) => {
                            const n1 = Number(a);
                            const n2 = Number(b);
                            return `${Math.min(n1, n2)}-${Math.max(n1, n2)}`;
                        };

                        const existingLinkKeys = new Set(links.map(l => {
                            const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
                            const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
                            return getLinkKey(s, t);
                        }));
                        const newLinksCount = validCached.filter(cn => {
                            // Check canonical link existence
                            return !existingLinkKeys.has(getLinkKey(node.id, cn.id));
                        }).length;

                        console.log(`💾 [Cache] contains ${newNodesCount} new nodes and ${newLinksCount} new links for ${node.title}`);

                        if (newNodesCount === 0 && newLinksCount === 0) {
                            console.log(`💾 [Cache] contains only existing/reverse connections. Falling back to LLM.`);
                            // Fall through to LLM logic below, DO NOT return
                        } else {
                            // Proceed to add them if they are truly new


                            // Otherwise, proceed to add them
                            let cacheNewNodes = 0;
                            let cacheNewLinks = 0;

                            setGraphData(prev => {
                                const existingNodeIds = new Set(prev.nodes.map(n => n.id));
                                const existingLinkIds = new Set(prev.links.map(l => l.id));
                                const nodeMap = new Map<number, GraphNode>(prev.nodes.map(n => [n.id, n]));

                                // We already know some are new, but allow the reducer to handle the merge details
                                validCached.forEach(cn => {
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
                                        imageChecked: !!imageUrl || existing?.imageChecked,
                                        wikiSummary: meta.wikiSummary ?? (existing as any)?.wikiSummary,
                                        expanded: existing?.expanded || false,
                                        isLoading: false
                                    };
                                    if (!existingNodeIds.has(cn.id)) cacheNewNodes += 1;
                                    nodeMap.set(cn.id, merged);
                                });
                                if (nodeMap.has(node.id)) {
                                    nodeMap.set(node.id, { ...nodeMap.get(node.id)!, expanded: true, isLoading: false });
                                }
                                const updatedNodes = Array.from(nodeMap.values());

                                const newLinksToAdd: GraphLink[] = validCached.map(cn => ({
                                    source: node.id,
                                    target: cn.id,
                                    id: `${node.id}-${cn.id}`
                                })).filter(l => !existingLinkIds.has(l.id));
                                cacheNewLinks = newLinksToAdd.length;
                                const combinedLinks = [...prev.links, ...newLinksToAdd];

                                return dedupeGraph(updatedNodes, combinedLinks);
                            });

                            // Log after the callback triggers (approximate) or just use our pre-calc
                            console.log(`💾 [Cache] scheduled add of ~${newNodesCount} nodes`);

                            validCached.forEach((cn, idx) => {
                                if (!cn.imageUrl && !cn.imageChecked && !isTextOnly) {
                                    setGraphData(prev => ({
                                        ...prev,
                                        nodes: prev.nodes.map(n => n.id === cn.id ? { ...n, imageChecked: true } : n)
                                    }));
                                    setTimeout(() => loadNodeImage(cn.id, cn.title), 200 * idx);
                                }
                            });
                            const needsWikiFix = [node, ...validCached].some(cn => !cn.wikipedia_id && !cn.wikiSummary && !(cn.meta && cn.meta.wikiSummary));
                            if (needsWikiFix) fixMissingWiki([node, ...validCached]);

                            console.log(`💾 [Cache] preventing fallback to LLM. Returning early.`);
                            setIsProcessing(false);
                            return;
                        }
                    }
                }
            }
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

            let wiki = { extract: node.wikiSummary || null, pageid: node.wikipedia_id ? Number(node.wikipedia_id) : null };
            if (!wiki.extract && !wiki.pageid) {
                wiki = await fetchWikipediaSummary(node.title, neighborNames.join(' '));
            }
            if (wiki.extract) {
                nodeUpdates.set(node.id, { wikiSummary: wiki.extract, wikipedia_id: wiki.pageid?.toString() });
            }
            console.log(`📄 [Expand] wiki summary for "${node.title}": ${wiki.extract ? wiki.extract.substring(0, 120) + '…' : 'none'} (pageid=${wiki.pageid || 'n/a'})`);

            let results: any[] = [];
            const isPerson = node.is_person ?? node.type.toLowerCase() === 'person';

            console.log(`📡 [Expand] Expanding ${node.type}: "${node.title}" (ID: ${node.id}, WikiID: ${node.wikipedia_id || 'none'})`);

            if (isPerson) {
                const data = await fetchPersonWorks(node.title, neighborNames, wiki.extract || undefined, node.wikipedia_id);
                results = (data.works || []).map(w => ({ title: w.entity, type: w.type, description: w.description, year: w.year, role: w.role }));
                console.log(`✅ [Expand] Found ${results.length} works for person "${node.title}"`);
            } else {
                const data = await fetchConnections(node.title, undefined, neighborNames, wiki.extract || undefined, node.wikipedia_id);
                if (data.sourceYear) nodeUpdates.set(node.id, { year: data.sourceYear });
                results = (data.people || []).map(p => ({ title: p.name, type: 'Person', description: p.description, role: p.role }));
                console.log(`✅ [Expand] Found ${results.length} people for event "${node.title}"`);
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

                let nodesToUse = resultsWithWiki;
                let isCacheHit = false;

                if (cacheEnabled) {
                    // Fetch existing cache first to merge
                    let combinedNodes = [...resultsWithWiki];
                    const existingCache = await fetchCacheExpansion(node.id);

                    if (existingCache && existingCache.nodes) {
                        const existingIds = new Set(existingCache.nodes.map((n: any) => n.title.toLowerCase())); // dedup by title roughly
                        const newUnique = resultsWithWiki.filter(n => !existingIds.has(n.title.toLowerCase()));
                        combinedNodes = [...existingCache.nodes, ...newUnique];
                        console.log(`💾 [Cache] Merging ${existingCache.nodes.length} existing + ${newUnique.length} new nodes.`);
                    }

                    await saveCacheExpansion(node.id, combinedNodes);

                    // Re-fetch from cache to get serial IDs
                    const cacheHit = await fetchCacheExpansion(node.id);
                    if (cacheHit && cacheHit.nodes) {
                        nodesToUse = cacheHit.nodes;
                        isCacheHit = true;
                    }
                }

                // Ensure all nodes have IDs and dedupe by normalized title to prevent duplicates (e.g., multiple Marlon Brando nodes).
                // Use baseDedupeKey for case-insensitive matching regardless of wikipedia_id
                const existingByNorm = new Map<string, GraphNode>(
                    (nodesOverride || nodes).map(n => [baseDedupeKey(n.title, n.type), n])
                );
                const processedNodes = nodesToUse.map(cn => {
                    const norm = baseDedupeKey(cn.title, cn.type);
                    const existing = existingByNorm.get(norm);
                    const idToUse = existing ? existing.id : (cn.id ?? Math.floor(Math.random() * 1000000));
                    if (!existing) {
                        // Track this norm so subsequent items map to the same ID if repeated
                        existingByNorm.set(norm, {
                            id: idToUse,
                            title: cn.title,
                            type: cn.type
                        } as GraphNode);
                    }
                    return { ...cn, id: idToUse };
                });

                setGraphData(prev => {
                    const nodeMap = new Map<number, GraphNode>(prev.nodes.map(n => [n.id, n]));
                    processedNodes.forEach(cn => {
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
                            imageChecked: !!(meta.imageUrl ?? existing?.imageUrl) || existing?.imageChecked,
                            wikiSummary: meta.wikiSummary ?? (existing as any)?.wikiSummary,
                            x: existing?.x ?? (node.x ? node.x + (Math.random() - 0.5) * 100 : undefined),
                            y: existing?.y ?? (node.y ? node.y + (Math.random() - 0.5) * 100 : undefined),
                            expanded: existing?.expanded || false,
                            isLoading: false
                        };
                        nodeMap.set(cn.id, merged);
                    });

                    if (nodeMap.has(node.id)) {
                        nodeMap.set(node.id, { ...nodeMap.get(node.id)!, expanded: true, isLoading: true, ...nodeUpdates.get(node.id) });
                    }

                    const updatedNodes = Array.from(nodeMap.values());
                    const existingLinkIds = new Set(prev.links.map(l => l.id));
                    const newLinksToAdd: GraphLink[] = processedNodes.map(cn => ({
                        source: node.id,
                        target: cn.id,
                        id: `${node.id}-${cn.id}`
                    })).filter(l => !existingLinkIds.has(l.id));

                    return dedupeGraph(updatedNodes, [...prev.links, ...newLinksToAdd]);
                });

                processedNodes.forEach((cn, idx) => {
                    if (!cn.imageUrl && !cn.imageChecked && !isTextOnly) {
                        // mark as checked to avoid duplicate requests while queued
                        setGraphData(prev => ({
                            ...prev,
                            nodes: prev.nodes.map(n => n.id === cn.id ? { ...n, imageChecked: true } : n)
                        }));
                        setTimeout(() => loadNodeImage(cn.id, cn.title), 300 * (idx + 1));
                    }
                });
                console.log(`🔗 [Expand] Added ${processedNodes.length} nodes and ${processedNodes.length} links from expansion of ${node.title}`);

                // Keep spinner visible until nodes have rendered
                setTimeout(() => {
                    setGraphData(prev => ({
                        ...prev,
                        nodes: prev.nodes.map(n => n.id === node.id ? { ...n, expanded: true, isLoading: false, ...nodeUpdates.get(node.id) } : n)
                    }));

                    // Center viewport on the expanded node after a brief delay for physics to settle
                    setTimeout(() => {
                        graphRef.current?.centerOnNode(node.id);
                    }, 200);
                }, 500);
            }
        } catch (error) {
            console.error("Failed to expand node", { nodeId: node.id, title: node.title, error });
            const msg = (error as any)?.message || 'unknown error';
            setError(`Failed to fetch connections: ${msg}`);
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: false } : n)
            }));
        } finally {
            clearTimeout(loadingGuard);
            setIsProcessing(false);
        }
    }, [nodes, links, loadNodeImage, cacheEnabled, fetchCacheExpansion, saveCacheExpansion, cacheBaseUrl, saveCacheNodeMeta]);

    const handleStartSearch = async (term: string, recursiveDepth = 0) => {
        setIsProcessing(true);
        setError(null);
        setSearchId(prev => prev + 1);
        setPathNodeIds([]); // Clear path highlighting when starting a new search

        try {
            console.log(`🔎 Starting search for: "${term}"`);

            // 1. Classify
            const { type, description: geminiDescription } = await classifyEntity(term);
            console.log(`Type: ${type}`);

            // 2. Get Wikipedia metadata
            const wiki = await fetchWikipediaSummary(term);
            const truncatedWiki = wiki.extract ? (wiki.extract.length > 100 ? wiki.extract.substring(0, 100) + "..." : wiki.extract) : "none";
            console.log(`Wiki summary: "${truncatedWiki}"`);

            // 3. Upsert to DB to get serial ID
            let nodeId: number = -1;
            if (cacheEnabled) {
                try {
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
                    if (res.ok) {
                        const data = await res.json();
                        nodeId = data.id;
                    }
                } catch (e) {
                    console.warn("Cache server unreachable", e);
                }
            }

            if (nodeId === -1) {
                // Fallback: use Wikipedia pageid or a random number
                nodeId = wiki.pageid || Math.floor(Math.random() * 1000000);
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

            console.log("Expanding initial node...");
            await fetchAndExpandNode(startNode, true, false, [startNode], []);

            if (recursiveDepth > 0) {
                // Trigger auto-expansion via shared handleExpandLeaves
                setPendingAutoExpandId(startNode.id);
            }
        } catch (e) {
            console.error("Search error details:", e);
            setError("Search failed. Please check your API key and network connection.");
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
            setPathNodeIds([]); // Clear previous path highlighting

        // Helper to clamp node positions within viewport bounds
        const clampToViewport = (x: number, y: number, margin: number = 100): { x: number, y: number } => {
            return {
                x: Math.max(margin, Math.min(dimensions.width - margin, x)),
                y: Math.max(margin, Math.min(dimensions.height - margin, y))
            };
        };

        try {
            console.log(`🛤️ Finding path from "${start}" to "${end}"`);

            // 1. Classify and Upsert endpoints
            const [startC, endC] = await Promise.all([
                classifyEntity(start),
                classifyEntity(end)
            ]);

            const [startWiki, endWiki] = await Promise.all([
                fetchWikipediaSummary(start),
                fetchWikipediaSummary(end)
            ]);

            const upsertNodeLocal = async (title: string, type: string, description: string, wiki: any) => {
                let id = -1;
                if (cacheEnabled) {
                    try {
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
                        if (res.ok) {
                            const data = await res.json();
                            id = data.id;
                        }
                    } catch (e) {
                        console.warn("Cache server unreachable", e);
                    }
                }
                if (id === -1) id = wiki.pageid || Math.floor(Math.random() * 1000000);
                return { id };
            };

            const [startNodeData, endNodeData] = await Promise.all([
                upsertNodeLocal(start, startC.type, startC.description || '', startWiki),
                upsertNodeLocal(end, endC.type, endC.description || '', endWiki)
            ]);

            const startNode: GraphNode = {
                id: startNodeData.id,
                title: start.trim(),
                type: startC.type,
                wikipedia_id: startWiki.pageid?.toString(),
                description: startWiki.extract || startC.description || 'Start of path discovery.',
                x: dimensions.width / 4,
                y: dimensions.height / 2,
                fx: dimensions.width / 4, // Fix position during path discovery
                fy: dimensions.height / 2,
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
                fx: (dimensions.width / 4) * 3, // Fix position during path discovery
                fy: dimensions.height / 2,
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
                    fetchAndExpandNode(startNode, true, false, [startNode, endNode], []).catch(e => console.warn("Start expansion failed", e)),
                    fetchAndExpandNode(endNode, true, false, [startNode, endNode], []).catch(e => console.warn("End expansion failed", e))
                ]);
            } catch (e) {
                console.warn("Endpoints expansion partially failed", e);
            }

            // 3. Try database pathfinding first, then fall back to AI
            setNotification({ message: "Finding connections...", type: 'success' });

            let pathData: PathResponse | null = null;
            let usingDatabase = false;

            // First, try database pathfinding (always try if cache server is available)
            try {
                const pathUrl = new URL("/path", cacheBaseUrl);
                pathUrl.searchParams.set("startId", startNodeData.id.toString());
                pathUrl.searchParams.set("endId", endNodeData.id.toString());
                pathUrl.searchParams.set("maxDepth", "10");
                const pathRes = await fetch(pathUrl.toString());
                if (pathRes.ok) {
                    const dbPath = await pathRes.json();
                    if (dbPath.found && dbPath.path && dbPath.path.length >= 2) {
                        // Store database nodes separately - they already have IDs
                        (pathData as any) = {
                            path: dbPath.path,
                            _dbPath: true // Flag to indicate this is from database
                        };
                        usingDatabase = true;
                        console.log("✅ Found path in database:", dbPath.path.length, "nodes");
                    } else {
                        console.log("❌ Database pathfinding: No path found in database");
                    }
                } else {
                    console.log("❌ Database pathfinding: Request failed with status", pathRes.status);
                }
            } catch (err) {
                console.warn("Database pathfinding failed, trying AI:", err);
            }

            // Fall back to AI if database didn't find a path
            if (!pathData) {
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

                try {
                    pathData = await fetchConnectionPath(start, end, {
                        startWiki: startWiki.extract || undefined,
                        endWiki: endWiki.extract || undefined
                    });
                } catch (err: any) {
                    clearInterval(thinkingInterval);
                    console.error("Pathfinding error:", err);
                    if (err.message?.includes("timed out")) {
                        setError("Pathfinding timed out. The connection might be too complex or obscure.");
                    } else if (err.message?.includes("too long") || err.message?.includes("parse")) {
                        setError("The AI generated a path that's too complex. Try a different connection or expand nodes first.");
                    } else {
                        setError("The AI failed to find a connection. Try more common entities or expand nodes to build connections first.");
                    }
                    return;
                } finally {
                    clearInterval(thinkingInterval);
                }
            }

            if (!pathData || !pathData.path || pathData.path.length < 2) {
                setError(usingDatabase 
                    ? "No path found in database. Try expanding nodes to build connections first."
                    : "The AI couldn't bridge these two entities. Try a different pair.");
                return;
            }

            // 4. Discover path one by one
            let currentTailId = startNode.id;
            const totalPathLength = pathData.path.length;
            const steps = totalPathLength - 1; // Steps to process (excluding start node)
            
            // Check if this is a database path (nodes already exist)
            const isDbPath = (pathData as any)._dbPath === true;
            
            // Initialize path list - will be built as we discover the path
            const pathNodeIdsList: number[] = [];
            
            console.log("Path discovery:", { 
                isDbPath, 
                totalPathLength, 
                steps, 
                startNodeId: startNode.id, 
                endNodeId: endNode.id,
                pathDataPath: pathData.path.map((p: any) => p.id || p.title)
            });
            
            if (isDbPath) {
                // Database path: nodes already exist, add them directly
                // First, build the pathNodeIdsList from dbNodes (before setGraphData callback)
                const dbNodes = pathData.path as any[]; // Database returns full node objects
                for (let i = 0; i < dbNodes.length; i++) {
                    pathNodeIdsList.push(dbNodes[i].id);
                }
                
                setGraphData(current => {
                    const updatedNodes = [...current.nodes];
                    const updatedLinks = [...current.links];
                    // Track existing links in an undirected way to avoid duplicates from reversed orientations
                    const linkKeys = new Set(updatedLinks.map(l => {
                        const s = typeof l.source === 'number' ? l.source : (l.source as GraphNode).id;
                        const t = typeof l.target === 'number' ? l.target : (l.target as GraphNode).id;
                        const a = Math.min(s, t);
                        const b = Math.max(s, t);
                        return `${a}-${b}`;
                    }));

                    // Add ALL path nodes including the start node (use database IDs)
                    for (let i = 0; i < dbNodes.length; i++) {
                        const dbNode = dbNodes[i];
                        const nodeId = dbNode.id;

                        // Check if node already exists in graph
                        let existingNode = updatedNodes.find(n => n.id === nodeId);
                        
                        if (!existingNode) {
                            // Node doesn't exist, add it
                            // For positioning: first node uses startNode position, others position near previous node
                            let nodeX, nodeY;
                            if (i === 0) {
                                // First node - use startNode position or default
                                nodeX = startNode.x ?? (dimensions.width / 4);
                                nodeY = startNode.y ?? (dimensions.height / 2);
                            } else {
                            // Position near previous node
                            const prevNodeId = dbNodes[i - 1].id;
                            const prevNode = updatedNodes.find(n => n.id === prevNodeId);
                            const prevX = prevNode?.x ?? (dimensions.width / 2);
                            const prevY = prevNode?.y ?? (dimensions.height / 2);
                            const offsetX = (Math.random() - 0.5) * 150;
                            const offsetY = (Math.random() - 0.5) * 150;
                            const clampedPos = clampToViewport(prevX + offsetX, prevY + offsetY, 80);
                            nodeX = clampedPos.x;
                            nodeY = clampedPos.y;
                            }

                            existingNode = {
                                id: nodeId,
                                title: dbNode.title,
                                type: dbNode.type,
                                wikipedia_id: dbNode.wikipedia_id,
                                description: dbNode.description || '',
                                year: dbNode.year || undefined,
                                imageUrl: dbNode.imageUrl || dbNode.image_url,
                                wikiSummary: dbNode.wikiSummary || dbNode.wiki_summary,
                                is_person: dbNode.is_person ?? (dbNode.type?.toLowerCase() === 'person'),
                                x: nodeX,
                                y: nodeY,
                                fx: nodeX, // Fix position during path discovery to prevent flying off screen
                                fy: nodeY,
                                expanded: false
                            };
                            updatedNodes.push(existingNode);
                            loadNodeImage(nodeId, existingNode.title);
                        }
                    }

                    // Create links along the discovered database path so the graph shows actual connections
                    for (let i = 0; i < dbNodes.length - 1; i++) {
                        const a = dbNodes[i].id;
                        const b = dbNodes[i + 1].id;
                        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
                        if (linkKeys.has(key)) continue;
                        linkKeys.add(key);
                        updatedLinks.push({
                            source: a,
                            target: b,
                            id: `${a}-${b}`
                        });
                    }

                    return dedupeGraph(updatedNodes, updatedLinks);
                });
            } else {
                // AI path: fetch nodes one by one
                // Track all node IDs in order as we build the path
                pathNodeIdsList.push(startNode.id); // Start with start node
                
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
                    const stepNodeData = await upsertNodeLocal(currentStep.id, currentStep.type, currentStep.description, stepWiki);
                    const resolvedId = stepNodeData.id;

                    // Add this node to the path list (avoid duplicates)
                    if (!pathNodeIdsList.includes(resolvedId)) {
                        pathNodeIdsList.push(resolvedId);
                    }

                    setGraphData(current => {
                        const existing = current.nodes.find(n => n.id === resolvedId);

                        // Find the tail node to position new node near it
                        const tailNode = current.nodes.find(n => n.id === tailId);
                        const tailX = tailNode?.x ?? (dimensions.width / 2);
                        const tailY = tailNode?.y ?? (dimensions.height / 2);

                        // Position new node near the tail node with constrained offset
                        const offsetX = (Math.random() - 0.5) * 150; // Reduced from 100 to 150 for better spacing
                        const offsetY = (Math.random() - 0.5) * 150;
                        const clampedPos = clampToViewport(tailX + offsetX, tailY + offsetY, 80);

                        const newNode: GraphNode = existing ? {
                            ...existing,
                            description: currentStep.description,
                            year: currentStep.year || existing.year,
                            expanded: existing.expanded,
                            fx: clampedPos.x, // Fix position during path discovery to prevent flying off screen
                            fy: clampedPos.y
                        } : {
                            id: resolvedId,
                            title: currentStep.id,
                            type: currentStep.type,
                            wikipedia_id: stepWiki.pageid?.toString(),
                            description: currentStep.description,
                            year: currentStep.year,
                            x: clampedPos.x,
                            y: clampedPos.y,
                            fx: clampedPos.x, // Fix position during path discovery to prevent flying off screen
                            fy: clampedPos.y,
                            expanded: false
                        };

                        const updatedNodes = existing
                            ? current.nodes.map(n => n.id === existing.id ? newNode : n)
                            : [...current.nodes, newNode];

                        setSelectedNode(newNode);

                        // Ensure the path is actually connected in the UI by creating links along the AI path
                        const canonicalKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
                        const existingLinkKeys = new Set(current.links.map(l => {
                            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                            return canonicalKey(sId, tId);
                        }));
                        const linkKey = canonicalKey(tailId, resolvedId);
                        const updatedLinks = existingLinkKeys.has(linkKey)
                            ? current.links
                            : [...current.links, { source: tailId, target: resolvedId, id: `${tailId}-${resolvedId}` }];

                        loadNodeImage(resolvedId, newNode.title);

                        // Trigger expansion outside state update
                        setTimeout(() => {
                            const nodeToExpand = updatedNodes.find(n => n.id === resolvedId);
                            if (nodeToExpand && !nodeToExpand.expanded) {
                                fetchAndExpandNode(nodeToExpand).catch(e => console.warn("Intermediate expansion failed", e));
                            }
                        }, 0);

                        return { nodes: updatedNodes, links: updatedLinks };
                    });

                    currentTailId = resolvedId;
                }
                
                // Ensure endNode.id is included (it might be the same as the last resolvedId due to deduplication,
                // or it might be different if the end node was created separately)
                if (!pathNodeIdsList.includes(endNode.id)) {
                    pathNodeIdsList.push(endNode.id);
                }
                
                console.log("AI path - nodes added to path list:", pathNodeIdsList);
            }

            // Highlight the path after completion (all nodes from start to end)
            // Clear selection first so path highlighting is not interfered with by focused node highlighting
            setSelectedNode(null);
            
            console.log("Path node IDs collected:", pathNodeIdsList, "Total:", pathNodeIdsList.length);
            console.log("Path details before highlighting:", {
                startNodeId: startNode.id,
                endNodeId: endNode.id,
                pathDataLength: pathData.path.length,
                steps: steps,
                collectedIds: pathNodeIdsList
            });
            
            // Wait for graph state to settle
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Use the path we collected during discovery
            // Filter to only include nodes that actually exist in the graph
            const currentNodes = graphDataRef.current.nodes;
            const nodeIdsInGraph = new Set(currentNodes.map(n => n.id));
            const finalPathIds = pathNodeIdsList.filter(id => nodeIdsInGraph.has(id));
            
            console.log("Final path node IDs to highlight:", finalPathIds, "Total nodes:", finalPathIds.length);
            console.log("Filtered out (not in graph):", pathNodeIdsList.filter(id => !nodeIdsInGraph.has(id)));
            
            // Release fixed positions after path discovery completes (let nodes move naturally)
            // Also gently lay out the discovered path along a smooth arc to avoid a single long edge that stays stretched
            setGraphData(current => {
                const pathIndex = new Map<number, number>();
                finalPathIds.forEach((id, idx) => pathIndex.set(id, idx));

                const width = Math.max(dimensions.width, 800);
                const height = Math.max(dimensions.height, 600);
                const margin = Math.min(160, width * 0.1);
                const pathCount = Math.max(finalPathIds.length, 2);
                // Keep nodes much closer together: span scales with count, capped to 65% viewport
                const perStep = 180;
                const minSpan = 260;
                const maxSpan = width * 0.65;
                const arcSpan = Math.min(Math.max((pathCount - 1) * perStep, minSpan), maxSpan);
                const arcAmplitude = Math.min(110, height * 0.2);

                const updatedNodes = current.nodes.map(node => {
                    let next = node;

                    // If node is in the path, position it along a gentle arc from left to right
                    if (pathIndex.has(node.id) && finalPathIds.length >= 2) {
                        const idx = pathIndex.get(node.id)!;
                        const t = finalPathIds.length === 1 ? 0 : idx / (finalPathIds.length - 1);
                        const x = margin + t * arcSpan;
                        const y = height / 2 + Math.sin((t - 0.5) * Math.PI) * arcAmplitude;
                        next = { ...next, x, y };
                    }

                    // Remove fixed positions to allow natural movement
                    if (next.fx !== undefined && next.fx !== null || next.fy !== undefined && next.fy !== null) {
                        next = { ...next, fx: null, fy: null };
                    }
                    return next;
                });
                return { ...current, nodes: updatedNodes };
            });
            
            setPathNodeIds([...finalPathIds]); // Create a new array to ensure React detects the change
            setNotification({ message: "Path discovery complete!", type: 'success' });

            // Nudge viewport toward the middle of the path so end nodes stay in view
            if (finalPathIds.length > 0) {
                const midIdx = Math.floor(finalPathIds.length / 2);
                const midId = finalPathIds[midIdx] ?? finalPathIds[0];
                setTimeout(() => {
                    graphRef.current?.centerOnNode(midId);
                }, 200);
            }

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

    const handleExpandMore = (node: GraphNode) => {
        fetchAndExpandNode(node, false, true);
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
        try {
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

            // Don't change selectedNode during expansion - just expand the nodes
            // This prevents state conflicts and rendering issues
            for (const targetNode of neighbors) {
                try {
                    // Verify node still exists before expanding
                    const nodeStillExists = nodes.some(n => n.id === targetNode.id);
                    if (!nodeStillExists) {
                        console.warn(`Node ${targetNode.id} no longer exists, skipping`);
                        continue;
                    }
                    
                    await fetchAndExpandNode(targetNode);
                    // Delay to allow physics and state to settle
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (e) {
                    console.error(`Failed to expand node ${targetNode.id} (${targetNode.title})`, e);
                    // Continue with next node instead of crashing
                }
            }

            setNotification({ message: `Expansion complete.`, type: 'success' });
        } catch (e) {
            console.error("Error in handleExpandLeaves:", e);
            setError("Error expanding leaf nodes. Please try again.");
            setNotification({ message: "Expansion failed.", type: 'error' });
        }
    }, [nodes, links, fetchAndExpandNode]);

    // Auto-expand trigger: when pendingAutoExpandId is set and the node is ready, call handleExpandLeaves
    useEffect(() => {
        if (!pendingAutoExpandId) return;

        const targetNode = nodes.find(n => n.id === pendingAutoExpandId);
        if (!targetNode) return;

        // Wait for the node to be expanded (initial expansion finished)
        if (!targetNode.expanded) return;

        // Clear the pending ID and trigger expansion
        console.log(`🔄 [Auto-Expand] Triggering handleExpandLeaves for node ${targetNode.id}`);
        setPendingAutoExpandId(null);
        setNotification({ message: "Auto-expanding connections...", type: 'success' });

        // Small delay to ensure state has settled after initial expansion
        setTimeout(() => {
            handleExpandLeaves(targetNode);
        }, 500);
    }, [pendingAutoExpandId, nodes, handleExpandLeaves]);

    const handleNodeClick = (node: GraphNode | null) => {
        if (!node) {
            setSelectedNode(null);
            setContextMenu(null);
            setPathNodeIds([]); // Clear path highlighting when deselecting
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

        // Check if this is a second click on the already selected node
        const isSecondClick = selectedNode && selectedNode.id === node.id;

        if (isSecondClick) {
            // Second click on selected node: show context menu
            setContextMenu({
                node,
                x: window.innerWidth / 3,
                y: window.innerHeight / 3
            });
        } else {
            // First click: select node to highlight connections
            setSelectedNode(node);
            setContextMenu(null);
            
            // Expand node if not already expanded
            if (!node.expanded && !node.isLoading) {
                console.log(`🖱️ [UI] node clicked -> expand`, { id: node.id, title: node.title, type: node.type });
                fetchAndExpandNode(node);
            }
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
        <div className="fixed inset-0 bg-slate-900 overflow-hidden">
            <header className="fixed top-0 left-0 right-0 z-50 min-h-14 bg-slate-900/95 backdrop-blur border-b border-slate-800 flex items-center justify-between px-2 sm:px-3 py-2 gap-2 overflow-x-hidden max-w-full">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <button
                        onClick={() => setPanelCollapsed(c => !c)}
                        className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white transition flex-shrink-0"
                        title={panelCollapsed ? "Show controls" : "Hide controls"}
                    >
                        {panelCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    </button>
                    <div className="text-base sm:text-lg font-bold text-red-500 whitespace-nowrap">
                        Constellations
                    </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                    {selectedNode && (
                        <button
                            onClick={() => { setSidebarCollapsed(c => !c); setSidebarToggleSignal(s => s + 1); }}
                            className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white transition flex-shrink-0"
                            title="Toggle details"
                        >
                            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                        </button>
                    )}
                </div>
            </header>
            <Graph
                ref={graphRef}
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
                highlightKeepIds={pathNodeIds.length > 0 ? pathNodeIds : (deletePreview?.keepIds)}
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
                isCollapsed={panelCollapsed}
                onSetCollapsed={setPanelCollapsed}
            />
            <Sidebar
                selectedNode={selectedNode}
                onClose={() => { setSelectedNode(null); setContextMenu(null); setPathNodeIds([]); }}
                externalToggleSignal={sidebarToggleSignal}
            />

            {contextMenu && (
                <NodeContextMenu
                    node={contextMenu.node}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onExpandLeaves={handleExpandLeaves}
                    onAddMore={handleExpandMore}
                    onDelete={handleSmartDelete}
                    onClose={() => setContextMenu(null)}
                    isProcessing={isProcessing}
                />
            )}

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
