"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GraphNode, GraphLink } from '../types';
import { LockedPair, findWikipediaTitle } from '../services/geminiService';
import { fetchServerImage, getImageApiBaseUrl } from '../services/imageService';
import { dedupeGraph } from '../services/graphUtils';
import { GraphHandle } from '../components/Graph';
import type { ConstellationsSessionHandoffV1 } from '../sessionHandoff';
import { graphFromHandoff } from '../sessionHandoff';

interface UseGraphStateOptions {
    cacheEnabled: boolean;
    cacheBaseUrl: string;
    /** Restored session from player embed → full screen (no re-query). */
    initialSession?: ConstellationsSessionHandoffV1 | null;
    /**
     * - `undefined` — measure the browser viewport (default standalone layout).
     * - `null` — embedded: container not mounted yet; use a placeholder size until the ref attaches.
     * - `HTMLElement` — embedded: size the graph to this element (ResizeObserver).
     */
    boundElement?: HTMLElement | null;
}

export function useGraphState(options: UseGraphStateOptions) {
    const { cacheEnabled, cacheBaseUrl, boundElement, initialSession: initialSessionOpt } = options;
    const initialSession = initialSessionOpt && initialSessionOpt.graph?.nodes?.length ? initialSessionOpt : null;
    const initialGraph = initialSession ? graphFromHandoff(initialSession) : { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    const [graphData, setGraphData] = useState<{ nodes: GraphNode[], links: GraphLink[] }>(initialGraph);
    const { nodes, links } = graphData;
    const graphDataRef = useRef(graphData);

    useEffect(() => {
        graphDataRef.current = graphData;
    }, [graphData]);

    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);

    const [isCompact, setIsCompact] = useState(!!initialSession?.isCompact);
    const [isTimelineMode, setIsTimelineMode] = useState(!!initialSession?.isTimelineMode);
    const [isTextOnly, setIsTextOnly] = useState(!!initialSession?.isTextOnly);
    const [searchMode, setSearchMode] = useState<'explore' | 'connect'>(initialSession?.searchMode ?? 'explore');
    const [error, setError] = useState<string | null>(null);
    const [isKeyReady, setIsKeyReady] = useState(false);
    const [searchId, setSearchId] = useState(initialSession?.searchId ?? 0);
    const searchIdRef = useRef(initialSession?.searchId ?? 0);

    useEffect(() => {
        searchIdRef.current = searchId;
    }, [searchId]);

    const [lockedPair, setLockedPair] = useState<LockedPair>(
        initialSession?.lockedPair ?? { atomicType: "Person", compositeType: "Event" }
    );
    const lockedPairRef = useRef<LockedPair>(lockedPair);
    useEffect(() => { lockedPairRef.current = lockedPair; }, [lockedPair]);

    const nodesRef = useRef<GraphNode[]>([]);
    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    const selectedNodeRef = useRef<GraphNode | null>(null);
    useEffect(() => {
        selectedNodeRef.current = selectedNode;
    }, [selectedNode]);

    const autoExpandMoreDoneRef = useRef<Set<string | number>>(new Set());

    const [deletePreview, setDeletePreview] = useState<{ keepIds: (number | string)[], dropIds: (number | string)[] } | null>(null);
    const [pathNodeIds, setPathNodeIds] = useState<(number | string)[]>(initialSession?.pathNodeIds ?? []);
    const [newlyExpandedNodeIds, setNewlyExpandedNodeIds] = useState<(number | string)[]>([]);
    const [expandingNodeId, setExpandingNodeId] = useState<number | string | null>(null);
    const [newChildNodeIds, setNewChildNodeIds] = useState<Set<number | string>>(new Set());
    const [helpHover, setHelpHover] = useState<string | null>(null);

    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    useEffect(() => {
        if (!notification) return;
        const timer = setTimeout(() => setNotification(null), 5000);
        return () => clearTimeout(timer);
    }, [notification]);

    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, message: string, onConfirm: () => void } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null);

    const [panelCollapsed, setPanelCollapsed] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarToggleSignal, setSidebarToggleSignal] = useState(0);
    const [peopleBrowserOpen, setPeopleBrowserOpen] = useState(false);
    const [savedGraphs, setSavedGraphs] = useState<string[]>([]);

    const [dimensions, setDimensions] = useState(() => {
        if (boundElement === undefined) {
            if (typeof window === "undefined") return { width: 800, height: 600 };
            return { width: window.innerWidth, height: window.innerHeight };
        }
        if (boundElement) {
            const r = boundElement.getBoundingClientRect();
            return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
        }
        return { width: 800, height: 600 };
    });
    useEffect(() => {
        if (boundElement === undefined) {
            const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
            handleResize();
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }
        if (boundElement === null) {
            return;
        }
        const el = boundElement;
        const ro = new ResizeObserver((entries) => {
            for (const e of entries) {
                const w = e.contentRect.width;
                const h = e.contentRect.height;
                if (w > 0 && h > 0) {
                    setDimensions({ width: w, height: h });
                }
            }
        });
        ro.observe(el);
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            setDimensions({ width: r.width, height: r.height });
        }
        return () => ro.disconnect();
    }, [boundElement]);

    const graphRef = useRef<GraphHandle>(null);

    // Prevent image "flapping"
    const imageReqTokenRef = useRef<Map<string | number, number>>(new Map());

    const saveCacheNodeMeta = useCallback(async (
        nodeId: number | string,
        meta: {
            imageUrl?: string | null,
            wikiSummary?: string | null,
            wikipedia_id?: string | null,
            mentioningPageTitles?: string[] | null
        },
        fallbackNode?: Partial<GraphNode> & { id: number | string; type?: string; title: string }
    ) => {
        if (!cacheEnabled) return;
        const node = nodesRef.current.find(n => String(n.id) === String(nodeId)) || fallbackNode;
        if (!node || !node.type) return;
        try {
            const metaToSend: any = {};
            const img = meta.imageUrl ?? (node as any).imageUrl;
            const wiki = meta.wikiSummary ?? (node as any).wikiSummary;
            const wikiId = meta.wikipedia_id ?? (node as any).wikipedia_id;
            const mentioning = meta.mentioningPageTitles ?? (node as any).mentioningPageTitles;
            if (img) metaToSend.imageUrl = img;
            if (wiki) metaToSend.wikiSummary = wiki;
            if (wikiId) metaToSend.wikipedia_id = wikiId;
            if (mentioning) metaToSend.mentioningPageTitles = mentioning;
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
            // console.warn("Cache node save failed", e);
        }
    }, [cacheEnabled, cacheBaseUrl]);

    const loadNodeImage = useCallback(async (
        nodeId: number | string,
        title: string,
        context?: string,
        fallbackNode?: Partial<GraphNode> & { id: number | string; type?: string; title: string },
        opts?: { force?: boolean }
    ) => {
        if (isTextOnly) return;

        const force = !!opts?.force;
        const current = graphDataRef.current.nodes.find(n => String(n.id) === String(nodeId));
        if (!force) {
            if (current?.imageUrl) return;
            if (current?.fetchingImage) return;
            if (current?.imageChecked) return;
        }

        const nextToken = (imageReqTokenRef.current.get(String(nodeId)) || 0) + 1;
        imageReqTokenRef.current.set(String(nodeId), nextToken);

        setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => String(n.id) === String(nodeId) ? { ...n, fetchingImage: true, imageChecked: true } : n)
        }));

        const imageBaseUrl = getImageApiBaseUrl(cacheBaseUrl);
        const effectiveContext = context || current?.type || fallbackNode?.type;
        const imageResult = await fetchServerImage(title, effectiveContext, imageBaseUrl);
        if ((imageReqTokenRef.current.get(String(nodeId)) || 0) !== nextToken) return;

        if (imageResult.url) {
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => {
                    if (String(n.id) !== String(nodeId)) return n;
                    if (!force && n.imageUrl) return { ...n, fetchingImage: false, imageChecked: true };
                    return {
                        ...n,
                        imageUrl: imageResult.url,
                        image_wikipedia_id: (imageResult as any).pageId?.toString(),
                        image_wikipedia_title: (imageResult as any).pageTitle,
                        fetchingImage: false,
                        imageChecked: true
                    };
                })
            }));
            // Persist the new image to the cache
            const wikiId = (imageResult as any).pageId?.toString();
            saveCacheNodeMeta(nodeId, { imageUrl: imageResult.url, wikipedia_id: wikiId }, fallbackNode);
        } else {
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => String(n.id) === String(nodeId) ? { ...n, fetchingImage: false, imageChecked: true } : n)
            }));
        }
    }, [isTextOnly, cacheEnabled, cacheBaseUrl, saveCacheNodeMeta]);

    const handleFindBetterImage = useCallback(async (nodeId: number | string) => {
        const node = graphDataRef.current.nodes.find(n => String(n.id) === String(nodeId));
        if (!node) return;

        setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => String(n.id) === String(nodeId) ? { ...n, fetchingImage: true } : n)
        }));

        setNotification({ message: `AI is looking for ${node.title}'s correct photo...`, type: 'success' });

        try {
            try {
                const imgCache: Map<string, string | null> | undefined = (window as any).__wikiImageCache;
                if (imgCache && typeof imgCache.delete === 'function') {
                    imgCache.delete(node.title.trim().toLowerCase());
                }
            } catch { }

            const aiSuggestion = await findWikipediaTitle(node.title, node.description);
            if (aiSuggestion) {
                const { title: betterTitle, imageHint } = aiSuggestion;
                try {
                    const imgCache: Map<string, string | null> | undefined = (window as any).__wikiImageCache;
                    if (imgCache && typeof imgCache.delete === 'function') {
                        if (betterTitle) imgCache.delete(betterTitle.trim().toLowerCase());
                        if (imageHint) imgCache.delete(imageHint.trim().toLowerCase());
                    }
                } catch { }

                if (imageHint) {
                    const imageBaseUrl = getImageApiBaseUrl(cacheBaseUrl);
                    const imageResult = await fetchServerImage(imageHint, node.type, imageBaseUrl);
                    if (imageResult.url) {
                        setGraphData(prev => ({
                            ...prev,
                            nodes: prev.nodes.map(n => String(n.id) === String(nodeId) ? {
                                ...n,
                                imageUrl: imageResult.url,
                                image_wikipedia_id: (imageResult as any).pageId?.toString(),
                                image_wikipedia_title: (imageResult as any).pageTitle,
                                fetchingImage: false,
                                imageChecked: true
                            } : n)
                        }));
                        // Persist the new image to the cache
                        const wikiId = (imageResult as any).pageId?.toString();
                        saveCacheNodeMeta(nodeId, { imageUrl: imageResult.url, wikipedia_id: wikiId });
                        setNotification({ message: "Better photo found via AI hint!", type: 'success' });
                        return;
                    }
                }

                await loadNodeImage(nodeId, betterTitle, node.type, undefined, { force: true });
                const updated = graphDataRef.current.nodes.find(n => String(n.id) === String(nodeId));
                if (updated?.imageUrl) {
                    setNotification({ message: "Better photo found!", type: 'success' });
                    return;
                }
            }

            await loadNodeImage(nodeId, node.title, node.type, undefined, { force: true });
            const updated = graphDataRef.current.nodes.find(n => String(n.id) === String(nodeId));
            if (updated?.imageUrl) {
                setNotification({ message: "Photo updated!", type: 'success' });
                return;
            }

            const imageBaseUrl = getImageApiBaseUrl(cacheBaseUrl);
            const serverResult = await fetchServerImage(node.title, node.type, imageBaseUrl);
            if (serverResult.url) {
                setGraphData(prev => ({
                    ...prev,
                    nodes: prev.nodes.map(n => String(n.id) === String(nodeId) ? {
                        ...n,
                        imageUrl: serverResult.url,
                        fetchingImage: false,
                        imageChecked: true
                    } : n)
                }));
                saveCacheNodeMeta(nodeId, { imageUrl: serverResult.url });
                setNotification({ message: "Image found via server lookup.", type: 'success' });
                return;
            }

            setNotification({ message: "No better photo found.", type: 'error' });
        } catch (e) {
            // console.error("Find better image failed", e);
            setNotification({ message: "Failed to find better photo.", type: 'error' });
        } finally {
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => String(n.id) === String(nodeId) ? { ...n, fetchingImage: false } : n)
            }));
        }
    }, [cacheEnabled, cacheBaseUrl, loadNodeImage, saveCacheNodeMeta, setNotification]);

    // Global safety net: dedupe graph whenever nodes/links change
    useEffect(() => {
        const deduped = dedupeGraph(nodes, links);
        const normalizedNodes = deduped.nodes.map(n => {
            if (n.is_atomic === undefined && typeof (n as any).is_person === 'boolean') {
                return { ...n, is_atomic: (n as any).is_person };
            }
            return n;
        });

        const nodesChanged =
            normalizedNodes.length !== nodes.length ||
            normalizedNodes.some((n, i) => n.id !== nodes[i]?.id || n.is_atomic !== nodes[i]?.is_atomic);
        const linksChanged =
            deduped.links.length !== links.length ||
            deduped.links.some((l, i) => l.id !== links[i]?.id);

        if (nodesChanged || linksChanged) {
            setGraphData({ nodes: normalizedNodes, links: deduped.links });
        }
    }, [nodes, links]);

    // Load saved graphs on init
    useEffect(() => {
        const loadSavedGraphs = async () => {
            if (cacheEnabled && cacheBaseUrl) {
                try {
                    const res = await fetch(new URL("/graphs", cacheBaseUrl).toString());
                    if (res.ok) {
                        const data = await res.json();
                        // Endpoint returns array of { name, updated_at }
                        const serverGraphs = data.map((g: any) => g.name);
                        setSavedGraphs(serverGraphs.sort());
                    } else {
                        const body = await res.text();
                        console.warn(
                            `[constellations] GET /graphs failed: ${res.status}. Check cache server logs (e.g. DB connection / saved_graphs).`,
                            body.slice(0, 500)
                        );
                    }
                } catch (e) {
                    console.warn("Failed to fetch saved graphs from server", e);
                }
            }
        };
        loadSavedGraphs();
    }, [cacheEnabled, cacheBaseUrl]);

    return {
        graphData,
        setGraphData,
        nodes,
        links,
        graphDataRef,
        isProcessing,
        setIsProcessing,
        selectedNode,
        setSelectedNode,
        selectedLink,
        setSelectedLink,
        isCompact,
        setIsCompact,
        isTimelineMode,
        setIsTimelineMode,
        isTextOnly,
        setIsTextOnly,
        error,
        setError,
        isKeyReady,
        setIsKeyReady,
        searchId,
        setSearchId,
        searchIdRef,
        lockedPair,
        setLockedPair,
        lockedPairRef,
        nodesRef,
        selectedNodeRef,
        autoExpandMoreDoneRef,
        loadNodeImage,
        handleFindBetterImage,
        saveCacheNodeMeta,
        deletePreview,
        setDeletePreview,
        pathNodeIds,
        setPathNodeIds,
        newlyExpandedNodeIds,
        setNewlyExpandedNodeIds,
        expandingNodeId,
        setExpandingNodeId,
        newChildNodeIds,
        setNewChildNodeIds,
        helpHover,
        setHelpHover,
        notification,
        setNotification,
        confirmDialog,
        setConfirmDialog,
        contextMenu,
        setContextMenu,
        panelCollapsed,
        setPanelCollapsed,
        sidebarCollapsed,
        setSidebarCollapsed,
        sidebarToggleSignal,
        setSidebarToggleSignal,
        peopleBrowserOpen,
        setPeopleBrowserOpen,
        dimensions,
        graphRef,
        savedGraphs,
        setSavedGraphs,
        searchMode,
        setSearchMode
    };
}
