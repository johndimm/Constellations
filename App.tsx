"use client";
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { buildWikiUrl } from './utils/wikiUtils';
import { Key, Search, HelpCircle, Minimize2, Maximize2, ExternalLink } from 'lucide-react';
import Graph from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import NodeContextMenu from './components/NodeContextMenu';
import AppHeader from './components/AppHeader';
import AppNotifications from './components/AppNotifications';
import AppConfirmDialog from './components/AppConfirmDialog';
import HelpOverlay from './components/HelpOverlay';
import { GraphNode, GraphLink } from './types';
import { getApiKey, getEnvCacheUrl, readBundledEnv } from './services/aiUtils';
import { useNodeClickHandler } from './hooks/useNodeClickHandler';

import { useGraphState } from './hooks/useGraphState';
import { useKioskMode } from './hooks/useKioskMode';
import { useExpansion } from './hooks/useExpansion';
import { useSearchHandlers } from './hooks/useSearchHandlers';
import { useGraphActions } from './hooks/useGraphActions';
import { buildHandoffFromLiveState, type ConstellationsSessionHandoffV1 } from './sessionHandoff';

const PeopleBrowserSidebar = lazy(() => import('./components/PeopleBrowserSidebar'));


type AppProps = {
    mode?: 'standalone' | 'extension';
    /** When true, fill the parent box and size the graph with ResizeObserver instead of the viewport. */
    embedded?: boolean;
    hideHeader?: boolean;
    hideControlPanel?: boolean;
    /**
     * When `hideControlPanel` is true, the Chrome extension still shows `ExtensionControls`.
     * Set to `false` for host-embedded “graph only” (e.g. Soundings player) — no left rail, no micro toolbar.
     */
    showExtensionWhenPanelHidden?: boolean;
    hideSidebar?: boolean;
    externalSearch?: { term: string; id: string | number } | null;
    onExternalSearchConsumed?: (id: string | number) => void;
    onNodeNavigate?: (node: GraphNode) => void;
    renderEvidencePopup?: (selectedLink: GraphLink | null, onClose: () => void) => React.ReactNode;
    /** When these strings match a node title (substring, case-insensitive), that node is expanded once per search. */
    autoExpandMatchTitles?: string[] | null;
    /**
     * When set (Soundings player / constellations page), the first match from `autoExpandMatchTitles`
     * also **selects** the node, and we wait for `nowPlayingKey` to change before re-applying.
     * String should change when album/track from the player updates.
     */
    nowPlayingKey?: string | null;
    /** e.g. optional cleanup (e.g. document class) when leaving full-screen; use with `closeHref` for navigation. */
    onClose?: () => void;
    /** If set, close control is an `<a href>` (see `AppHeader`); e.g. `/` (Trailer Vision) or `/player` (Soundings). */
    closeHref?: string;
    /** Soundings: create a new DJ channel seeded from the right-clicked graph node. */
    onNewChannelFromNode?: (node: GraphNode) => void;
    /**
     * Restored graph from player embed (session handoff) — avoids re-running searches.
     * Only used on full-screen mount; not for embedded mode.
     */
    initialSession?: ConstellationsSessionHandoffV1 | null;
    /**
     * When embedded in an app that already shows a top nav (e.g. Trailer Vision ~44px), set to that
     * height in px so fixed toolbars sit below the host nav and clicks reach the right layer.
     */
    hostNavOffsetPx?: number;
    /**
     * When `embedded`, panels default to `position:absolute` in the constellations root. Set
     * `true` for full-viewport overlay hosts (e.g. Soundings) so the control rail and details use
     * viewport-anchored layout + classic max-heights; keeps blur/shadows aligned to the window edge.
     */
    useViewportForPanels?: boolean;
    /** When set, ControlPanel shows a link to the graph settings page. */
    settingsHref?: string;
};

const ExtensionControls: React.FC<{
    isTimelineMode: boolean;
    onToggle: (val: boolean) => void;
    exploreTerm: string;
    setExploreTerm: (val: string) => void;
    onSearch: (val: string) => void;
    isCompact: boolean;
    onToggleCompact: () => void;
    onToggleHelp: () => void;
}> = ({
    isTimelineMode, onToggle, exploreTerm, setExploreTerm,
    onSearch, isCompact, onToggleCompact, onToggleHelp
}) => {
        return (
            <div
                className="fixed top-6 left-6 flex items-center gap-3 bg-slate-900/95 p-1.5 rounded-xl border border-slate-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[9999]"
            >
                <div className="flex bg-slate-800/50 rounded-lg p-0.5 border border-slate-700/50">
                    <button
                        onClick={() => onToggle(false)}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${!isTimelineMode
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'text-slate-500 hover:text-slate-300'
                            }`}
                    >
                        Net
                    </button>
                    <button
                        onClick={() => onToggle(true)}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${isTimelineMode
                            ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                            : 'text-slate-500 hover:text-slate-300'
                            }`}
                    >
                        Time
                    </button>
                </div>

                <div className="h-6 w-[1px] bg-slate-700/50" />

                <form
                    onSubmit={(e) => { e.preventDefault(); onSearch(exploreTerm); }}
                    className="relative group"
                >
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={14} />
                    <input
                        type="text"
                        value={exploreTerm}
                        onChange={(e) => setExploreTerm(e.target.value)}
                        placeholder="Search..."
                        className="bg-slate-800/80 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 w-48 sm:w-64 md:w-80 transition-all"
                    />
                </form>

                <div className="h-6 w-[1px] bg-slate-700/50" />

                <div className="flex items-center gap-1">
                    <button
                        onClick={onToggleCompact}
                        className={`p-1.5 rounded-lg border transition-all ${isCompact ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'}`}
                        title="Toggle Compact Mode"
                    >
                        {isCompact ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    <button
                        onClick={onToggleHelp}
                        className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-400 hover:text-white transition-all"
                        title="Help"
                    >
                        <HelpCircle size={16} />
                    </button>
                    <div className="h-6 w-[1px] bg-slate-700/50" />
                    <button
                        onClick={() => {
                            const isExtension = window.location.protocol === 'chrome-extension:';
                            const baseOrigin = isExtension ? 'https://constellations-delta.vercel.app' : window.location.origin;
                            const url = new URL(baseOrigin);
                            if (exploreTerm) url.searchParams.set('q', exploreTerm);
                            window.open(url.toString(), '_blank');
                        }}
                        className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 transition-all"
                        title="Open in Standalone App"
                    >
                        <ExternalLink size={16} />
                    </button>
                </div>
            </div>
        );
    };

const App: React.FC<AppProps> = ({
    embedded = false,
    hideHeader = false,
    hideControlPanel = false,
    showExtensionWhenPanelHidden = true,
    hideSidebar = false,
    externalSearch = null,
    onExternalSearchConsumed,
    onNodeNavigate,
    renderEvidencePopup,
    autoExpandMatchTitles = null,
    nowPlayingKey = null,
    onClose,
    closeHref,
    onNewChannelFromNode,
    initialSession: initialSessionProp = null,
    hostNavOffsetPx = 0,
    useViewportForPanels = false,
    settingsHref,
}) => {
    const initialSession = initialSessionProp && initialSessionProp.graph?.nodes?.length
        ? initialSessionProp
        : null;
    const skipPlayerBootstrapRef = useRef(!!initialSession);
    const wsRaw = readBundledEnv('VITE_ENABLE_WEB_SEARCH');
    const ENABLE_WEB_SEARCH = String(wsRaw).trim().toLowerCase() === 'true' || wsRaw === '1';
    const acadRaw = readBundledEnv('VITE_ENABLE_ACADEMIC_CORPORA');
    const ENABLE_ACADEMIC_CORPORA = acadRaw !== 'false' && acadRaw !== '0';

    const cacheBaseUrl = getEnvCacheUrl();
    const cacheEnabled = !!cacheBaseUrl;

    const [graphHostEl, setGraphHostEl] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (embedded) return;
        const root = document.documentElement;
        root.classList.add("constellations-standalone");
        return () => root.classList.remove("constellations-standalone");
    }, [embedded]);

    const {
        isAdminMode, kioskDomains, setKioskDomains, selectedKioskDomainId, setSelectedKioskDomainId,
        selectedKioskDomain, kioskSeedTerms
    } = useKioskMode();

    const state = useGraphState({
        cacheEnabled,
        cacheBaseUrl,
        boundElement: embedded ? graphHostEl : undefined,
        initialSession
    });
    const {
        graphData, setGraphData, nodes, links, graphDataRef,
        isProcessing, setIsProcessing, selectedNode, setSelectedNode,
        selectedLink, setSelectedLink, isCompact, setIsCompact,
        isTimelineMode, setIsTimelineMode, isTextOnly, setIsTextOnly,
        dimensions, error, setError, isKeyReady, setIsKeyReady,
        nodesRef, graphRef, autoExpandMoreDoneRef, searchId, setSearchId,
        searchIdRef, deletePreview, setDeletePreview, pathNodeIds, setPathNodeIds,
        newlyExpandedNodeIds, setNewlyExpandedNodeIds, expandingNodeId, setExpandingNodeId,
        newChildNodeIds, setNewChildNodeIds, helpHover, setHelpHover,
        notification, setNotification, confirmDialog, setConfirmDialog,
        contextMenu, setContextMenu, panelCollapsed, setPanelCollapsed,
        sidebarCollapsed, setSidebarCollapsed, sidebarToggleSignal, setSidebarToggleSignal,
        peopleBrowserOpen, setPeopleBrowserOpen, savedGraphs, setSavedGraphs,
        searchMode, setSearchMode, lockedPair, loadNodeImage, handleFindBetterImage, saveCacheNodeMeta
    } = state;

    const { fetchAndExpandNode, saveCacheExpansion } = useExpansion({
        graphDataRef, setGraphData, setIsProcessing, setError, searchIdRef, lockedPairRef: state.lockedPairRef,
        nodesRef, selectedNodeRef: state.selectedNodeRef, autoExpandMoreDoneRef,
        cacheEnabled, cacheBaseUrl, ENABLE_ACADEMIC_CORPORA, ENABLE_WEB_SEARCH,
        loadNodeImage, saveCacheNodeMeta,
        setNewlyExpandedNodeIds, setExpandingNodeId, setNewChildNodeIds,
        setSelectedNode, setSelectedLink, exploreTerm: '', isTextOnly, graphRef
    });

    const [showHelp, setShowHelp] = useState(false);

    const {
        exploreTerm, setExploreTerm, pathStart, setPathStart, pathEnd, setPathEnd,
        handleStartSearch, handlePathSearch
    } = useSearchHandlers({
        graphDataRef, setGraphData, setIsProcessing, setError, setSearchId, searchIdRef,
        setLockedPair: state.setLockedPair, dimensions, cacheEnabled, cacheBaseUrl, loadNodeImage, fetchAndExpandNode,
        setNotification, setSelectedNode, setSelectedLink, setPathNodeIds, setPendingAutoExpandId: () => { },
        showControlPanel: !hideControlPanel, selectedKioskDomain, graphRef,
        initialSession
    });

    const {
        handleClear, handleClearCache, handlePrune, handleSmartDelete, handleExpandLeaves,
        handleExpandMore, handleExpandAllLeafNodes, handleDeleteGraph,
        handleSaveGraph, handleLoadGraph, handleImport
    } = useGraphActions({
        nodes, links, setGraphData, setSelectedNode, setSelectedLink,
        setContextMenu, setNotification, setConfirmDialog, setDeletePreview,
        setPathNodeIds, fetchAndExpandNode, setIsProcessing, searchIdRef,
        cacheEnabled, cacheBaseUrl, setSavedGraphs, searchMode, exploreTerm,
        pathStart, pathEnd, isCompact, isTimelineMode, isTextOnly,
        setExpandingNodeId, setNewChildNodeIds
    });

    const onNodeClick = useNodeClickHandler({
        selectedNode, setSelectedNode, setContextMenu,
        graphData,
        setExpandingNodeId,
        setNewChildNodeIds,
        onNavigate: onNodeNavigate ? (node) => {
            onNodeNavigate(node);
        } : undefined,
        onExpand: isTimelineMode ? undefined : fetchAndExpandNode,
        onDeselect: () => {
            setPathNodeIds([]);
            setSelectedLink(null);
            setExpandingNodeId(null);
            setNewChildNodeIds(new Set());
        },
        onClearSecondarySelection: () => {
            setSelectedLink(null);
        },
        getMenuPosition: (node, event) => ({ x: event?.clientX ?? 0, y: event?.clientY ?? 0 })
    });

    const handleNodeContextMenu = useCallback((event: MouseEvent, node: GraphNode) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedNode(node);
        setContextMenu({ node, x: event.clientX, y: event.clientY });
    }, [setSelectedNode, setContextMenu]);

    useEffect(() => {
        const checkKey = async () => {
            if (cacheBaseUrl) {
                setIsKeyReady(true);
                return;
            }
            const envKey = await getApiKey();
            if ((window as any).aistudio) {
                const hasKey = await (window as any).aistudio.hasSelectedApiKey();
                setIsKeyReady(hasKey || !!envKey);
            } else {
                if (envKey) setIsKeyReady(true);
            }
        };
        checkKey();
    }, [setIsKeyReady]);

    const handleStartSearchRef = useRef(handleStartSearch);
    useEffect(() => {
        handleStartSearchRef.current = handleStartSearch;
    }, [handleStartSearch]);
    const onExternalSearchConsumedRef = useRef(onExternalSearchConsumed);
    useEffect(() => {
        onExternalSearchConsumedRef.current = onExternalSearchConsumed;
    }, [onExternalSearchConsumed]);

    useEffect(() => {
        if (skipPlayerBootstrapRef.current) return;
        if (!externalSearch?.term) return;
        handleStartSearchRef.current(externalSearch.term);
        if (externalSearch?.id !== undefined) {
            onExternalSearchConsumedRef.current?.(externalSearch.id);
        }
    }, [externalSearch?.id, externalSearch?.term]);

    const autoExpandDoneRef = useRef<Set<string>>(new Set());
    const pendingNpFocusRef = useRef(false);

    useEffect(() => {
        if (nowPlayingKey != null && nowPlayingKey !== "") {
            pendingNpFocusRef.current = true;
        } else {
            pendingNpFocusRef.current = false;
        }
    }, [nowPlayingKey]);

    useEffect(() => {
        if (!autoExpandMatchTitles?.length) return;
        if (!nodes.length || isProcessing) return;
        const syncFromPlayer = nowPlayingKey != null && nowPlayingKey !== "";
        if (syncFromPlayer && !pendingNpFocusRef.current) return;

        const searchSig = `${searchId}`;
        for (const raw of autoExpandMatchTitles) {
            const want = raw.trim();
            if (!want) continue;
            const expandOnceKey = `${searchSig}::${want.toLowerCase()}`;
            if (autoExpandDoneRef.current.has(expandOnceKey) && !syncFromPlayer) continue;

            const wl = want.toLowerCase();
            const found = nodes.find((n) => {
                if (n.isLoading) return false;
                const nt = (n.title || '').toLowerCase();
                if (syncFromPlayer) {
                    return nt === wl || nt.includes(wl) || wl.includes(nt);
                }
                if (n.expanded) return false;
                return nt === wl || nt.includes(wl) || wl.includes(nt);
            });
            if (!found) continue;

            if (syncFromPlayer) {
                setSelectedNode(found);
                setSelectedLink(null);
                setContextMenu(null);
                pendingNpFocusRef.current = false;
            }
            if (!autoExpandDoneRef.current.has(expandOnceKey) && !found.expanded) {
                autoExpandDoneRef.current.add(expandOnceKey);
                void fetchAndExpandNode(found, false, false);
            }
            break;
        }
    }, [
        nodes,
        isProcessing,
        searchId,
        autoExpandMatchTitles,
        nowPlayingKey,
        fetchAndExpandNode,
        setSelectedNode,
        setSelectedLink,
        setContextMenu
    ]);

    useEffect(() => {
        const handlePopState = () => {
            const params = new URLSearchParams(window.location.search);
            setPeopleBrowserOpen(params.get('browse') === 'people');
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [setPeopleBrowserOpen]);

    const handoffSelectionRestored = useRef(false);
    useEffect(() => {
        if (!initialSession?.selectedNodeId || handoffSelectionRestored.current) return;
        const id = initialSession.selectedNodeId;
        const n = nodes.find((x) => String(x.id) === String(id));
        if (n) {
            setSelectedNode(n);
            handoffSelectionRestored.current = true;
        }
    }, [initialSession, nodes, setSelectedNode]);

    useEffect(() => {
        if (!initialSession) return;
        if (!nodes.length) return;
        skipPlayerBootstrapRef.current = false;
    }, [initialSession, nodes.length]);

    useEffect(() => {
        if (!embedded) {
            return undefined;
        }
        (window as any).__soundingsConstellationsGetHandoff = () => {
            try {
                return buildHandoffFromLiveState({
                    graph: graphDataRef.current,
                    exploreTerm,
                    pathStart,
                    pathEnd,
                    searchMode,
                    isCompact,
                    isTimelineMode,
                    isTextOnly,
                    searchId,
                    lockedPair,
                    pathNodeIds,
                    selectedNodeId: selectedNode?.id
                });
            } catch {
                return null;
            }
        };
        return () => {
            try { delete (window as any).__soundingsConstellationsGetHandoff; } catch { /* empty */ }
        };
    }, [
        embedded,
        graphData,
        exploreTerm,
        pathStart,
        pathEnd,
        searchMode,
        isCompact,
        isTimelineMode,
        isTextOnly,
        searchId,
        lockedPair,
        pathNodeIds,
        selectedNode
    ]);

    const handlePathSearchRef = useRef(handlePathSearch);
    useEffect(() => {
        handlePathSearchRef.current = handlePathSearch;
    }, [handlePathSearch]);

    // Auto-start search if ?q= parameter is present in URL
    const urlQueryProcessedRef = useRef(false);
    useEffect(() => {
        if (urlQueryProcessedRef.current) return;
        if (skipPlayerBootstrapRef.current) {
            urlQueryProcessedRef.current = true;
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const queryParam = params.get('q');
        const startParam = params.get('start');
        const endParam = params.get('end');

        if (queryParam && isKeyReady && nodes.length === 0) {
            urlQueryProcessedRef.current = true;
            handleStartSearchRef.current(queryParam);
        } else if (startParam && endParam && isKeyReady && nodes.length === 0) {
            urlQueryProcessedRef.current = true;
            setSearchMode('connect');
            setPathStart(startParam);
            setPathEnd(endParam);
            handlePathSearchRef.current(startParam, endParam);
        }
    }, [isKeyReady, nodes.length, setSearchMode, setPathStart, setPathEnd]);

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

            setGraphData({
                nodes: savedNodes.map((n: any) => ({ ...n, isLoading: false, vx: 0, vy: 0, fx: null, fy: null })),
                links: savedLinks
            });
            setSearchId(prev => prev + 1);
            setError(null);
            setNotification({ message: `Graph "${sourceLabel}" loaded!`, type: 'success' });
        } catch (e) {
            setError("Failed to load graph data.");
            setNotification({ message: "Error loading graph.", type: 'error' });
        }
    }, [setNotification, setSearchMode, setExploreTerm, setPathStart, setPathEnd, setIsCompact, setIsTimelineMode, setIsTextOnly, setGraphData, setSearchId, setError]);

    const handleOpenPeopleBrowser = useCallback(() => {
        const newParams = new URLSearchParams(window.location.search);
        newParams.set('browse', 'people');
        window.history.pushState({ browse: 'people' }, '', window.location.pathname + '?' + newParams.toString());
        setPeopleBrowserOpen(true);
    }, [setPeopleBrowserOpen]);

    if (!isKeyReady) {
        return (
            <div className={`flex flex-col items-center justify-center bg-slate-900 text-white space-y-6 ${embedded ? "h-full w-full" : "h-screen w-screen"}`}>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">Constellations</h1>
                <button onClick={async () => { if ((window as any).aistudio) { await (window as any).aistudio.openSelectKey(); setIsKeyReady(true); } }} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105">
                    <Key size={20} className="inline mr-2" /> Select API Key
                </button>
            </div>
        );
    }

    // Fresh graph row for the open context menu (stale `node` would miss isLoading/expanded updates).
    const contextMenuNodeLive: GraphNode | null = contextMenu
        ? (nodes.find((n) => String(n.id) === String(contextMenu.node.id)) ?? contextMenu.node)
        : null;

    // Match `pt-14` on the main column: avoid sizing the graph to full window height, which
    // makes the SVG overflow under the bar and steal clicks. AppHeader is `absolute` inside this
    // root (not `fixed` to the viewport) so the whole UI shares one stacking context with the graph.
    const HEADER_PX = 56;
    const graphWidth = dimensions.width;
    const graphHeight = hideHeader
        ? dimensions.height
        : Math.max(200, dimensions.height - HEADER_PX);

    /**
     * In-flow (absolute) panels: positioned relative to `main` — the host’s nav (e.g. Trailer h-11)
     * is *outside* the constellations root, so `top-14` (below the in-root header) is enough.
     * When `hideHeader`, there is no in-app bar — use `top-2` and pin the control rail with
     * `constrainToParentHeight` (see `ControlPanel`) so we do not reserve a fake 56px gap.
     *
     * `position: fixed` panels (Sidebar, people browser) use *viewport* coordinates. When embedded
     * with an in-app header, we used `top-[6.25rem]` for host nav + const bar; with `hideHeader`
     * embeds, align to the content box with `top-2` like the control bar.
     */
    const inHostSizedBox = embedded;
    const headerOffsetClass = inHostSizedBox
        ? "top-0"
        : (hostNavOffsetPx > 0 ? "top-11" : "top-0");
    /** No in-app `AppHeader`: `top-2` for both embedded and full-viewport (e.g. Soundings / Trailer) */
    const inFlowPanelTopClass = inHostSizedBox
        ? (hideHeader ? "top-2" : "top-14")
        : (hostNavOffsetPx > 0 ? "top-[6.25rem]" : (hideHeader ? "top-2" : "top-14"));
    /** Embedded + host bar (e.g. Soundings /player) uses `hostNavOffsetPx`; full-page overlay with only
     *  Constellations header uses `top-14` / `top-16` like non-embedded. */
    const viewportFixedTopClass = inHostSizedBox
        ? (hideHeader ? "top-2" : (hostNavOffsetPx > 0 ? "top-[6.25rem]" : "top-14"))
        : (hostNavOffsetPx > 0 ? "top-[6.25rem]" : (hideHeader ? "top-2" : "top-14"));
    const peopleBrowserFixedTopClass = inHostSizedBox
        ? (hideHeader ? "top-2" : (hostNavOffsetPx > 0 ? "top-28" : "top-16"))
        : (hostNavOffsetPx > 0 ? "top-[6.25rem]" : (hideHeader ? "top-2" : "top-16"));
    /** In-layout absolute rails (Tight embed under host chrome). Full-viewport overlay uses `fixed` + max-h. */
    const useViewportPanels = Boolean(embedded && useViewportForPanels);
    const controlPanelOffsetClass = hideHeader
        ? "top-2 bottom-2"
        : inFlowPanelTopClass;
    const controlPanelConstrainToParent = hideHeader && !hideControlPanel && !useViewportPanels;
    const sidebarOffsetClass = useViewportPanels
        ? viewportFixedTopClass
        : (embedded ? inFlowPanelTopClass : viewportFixedTopClass);
    const peopleBrowserOffsetClass = useViewportPanels
        ? peopleBrowserFixedTopClass
        : (embedded ? inFlowPanelTopClass : peopleBrowserFixedTopClass);
    const sidePanelUseAbsolute = embedded && !useViewportPanels;
    const showExtensionControls =
        hideControlPanel && showExtensionWhenPanelHidden;

    return (
        <div
            ref={embedded ? (n) => setGraphHostEl(n) : undefined}
            className={`${
                embedded ? "relative w-full h-full" : "relative h-screen w-screen"
            } bg-slate-950 overflow-hidden font-sans text-slate-200 selection:bg-indigo-500/30`}
        >
            {showExtensionControls && (
                <ExtensionControls
                    isTimelineMode={isTimelineMode}
                    onToggle={setIsTimelineMode}
                    exploreTerm={exploreTerm}
                    setExploreTerm={setExploreTerm}
                    onSearch={handleStartSearch}
                    isCompact={isCompact}
                    onToggleCompact={() => setIsCompact(!isCompact)}
                    onToggleHelp={() => setShowHelp(true)}
                />
            )}

            <HelpOverlay
                isOpen={showHelp}
                onClose={() => setShowHelp(false)}
                isExtension={showExtensionControls}
                onOpenPeopleBrowser={handleOpenPeopleBrowser}
            />

            <div
                className={`relative z-0 w-full min-h-0 h-full transition-all duration-500 ease-in-out ${!hideHeader ? "pt-14" : ""}`}
            >
                <div className="pointer-events-auto relative z-0 min-h-0 w-full overflow-hidden" style={{ height: graphHeight, maxHeight: "100%" }}>
                    <Graph
                        ref={graphRef}
                        nodes={nodes}
                        links={links}
                        onNodeClick={onNodeClick}
                        onNodeContextMenu={handleNodeContextMenu}
                        onLinkClick={(link) => {
                            setSelectedLink(link);
                            setSelectedNode(null);
                            setContextMenu(null);
                        }}
                        width={graphWidth}
                        height={graphHeight}
                        isCompact={isCompact}
                        isTimelineMode={isTimelineMode}
                        isTextOnly={isTextOnly}
                        searchId={searchId}
                        selectedNode={selectedNode}
                        highlightKeepIds={deletePreview ? deletePreview.keepIds : pathNodeIds}
                        highlightDropIds={deletePreview ? deletePreview.dropIds : []}
                        expandingNodeId={expandingNodeId}
                        newChildNodeIds={newChildNodeIds}
                    />
                </div>


                {!hideControlPanel && (
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
                        isAdminMode={isAdminMode}
                        kioskSeedTerms={kioskSeedTerms}
                        kioskDomains={kioskDomains}
                        selectedKioskDomainId={selectedKioskDomainId}
                        onSelectKioskDomain={(id) => { setSelectedKioskDomainId(id); setPathStart(''); setPathEnd(''); }}
                        onUpdateKioskDomains={setKioskDomains}
                        isProcessing={isProcessing}
                        isCompact={isCompact}
                        onToggleCompact={() => setIsCompact(!isCompact)}
                        isTimelineMode={isTimelineMode}
                        onToggleTimeline={() => setIsTimelineMode(!isTimelineMode)}
                        isTextOnly={isTextOnly}
                        onToggleTextOnly={() => setIsTextOnly(!isTextOnly)}
                        isCollapsed={panelCollapsed}
                        settingsHref={settingsHref}
                        onSetCollapsed={setPanelCollapsed}
                        onOpenPeopleBrowser={handleOpenPeopleBrowser}
                        offsetTopClass={controlPanelOffsetClass}
                        constrainToParentHeight={controlPanelConstrainToParent}
                        pinToViewport={useViewportPanels}
                    />
                )}

                {!hideSidebar && (
                    <Sidebar
                        selectedNode={selectedNode}
                        selectedLink={selectedLink}
                        onClose={() => { setSelectedNode(null); setSelectedLink(null); setContextMenu(null); setPathNodeIds([]); }}
                        onCollapseChange={setSidebarCollapsed}
                        externalToggleSignal={sidebarToggleSignal}
                        isAdminMode={isAdminMode}
                        useAbsoluteLayout={sidePanelUseAbsolute}
                        offsetTopClass={sidebarOffsetClass}
                    />
                )}

                {renderEvidencePopup && renderEvidencePopup(selectedLink, () => setSelectedLink(null))}

                <Suspense fallback={null}>
                    <PeopleBrowserSidebar
                        isOpen={peopleBrowserOpen}
                        useAbsoluteLayout={sidePanelUseAbsolute}
                        offsetTopClass={peopleBrowserOffsetClass}
                        onClose={() => setPeopleBrowserOpen(false)}
                        onSelectPerson={(name) => {
                            setExploreTerm(name);
                            setPeopleBrowserOpen(false);
                            const params = new URLSearchParams(window.location.search);
                            params.delete('browse');
                            params.set('q', name);
                            window.history.pushState({}, '', window.location.pathname + '?' + params.toString());
                            handleStartSearch(name, 1);
                        }}
                    />
                </Suspense>

                {contextMenu && contextMenuNodeLive && (
                    <NodeContextMenu
                        node={contextMenuNodeLive}
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onExpandLeaves={handleExpandLeaves}
                        onAddMore={handleExpandMore}
                        onFindBetterPhoto={handleFindBetterImage}
                        onNewChannelFromNode={onNewChannelFromNode}
                        onDelete={handleSmartDelete}
                        onClose={() => setContextMenu(null)}
                        isProcessing={isProcessing}
                    />
                )}

                <AppNotifications notification={notification} />
                <AppConfirmDialog
                    confirmDialog={confirmDialog}
                    onClose={() => {
                        setConfirmDialog(null);
                        setDeletePreview(null);
                    }}
                />
            </div>

            <AppHeader
                showHeader={!hideHeader}
                panelCollapsed={panelCollapsed}
                setPanelCollapsed={setPanelCollapsed}
                selectedNode={selectedNode}
                sidebarCollapsed={sidebarCollapsed}
                setSidebarToggleSignal={setSidebarToggleSignal}
                onClose={onClose}
                closeHref={closeHref}
                offsetTopClass={headerOffsetClass}
            />
        </div>
    );
};

export default App;
