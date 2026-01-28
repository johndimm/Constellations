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
import { getApiKey, getEnvCacheUrl } from './services/aiUtils';
import { useNodeClickHandler } from './hooks/useNodeClickHandler';

import { useGraphState } from './hooks/useGraphState';
import { useKioskMode } from './hooks/useKioskMode';
import { useExpansion } from './hooks/useExpansion';
import { useSearchHandlers } from './hooks/useSearchHandlers';
import { useGraphActions } from './hooks/useGraphActions';

const PeopleBrowserSidebar = lazy(() => import('./components/PeopleBrowserSidebar'));


type AppProps = {
    mode?: 'standalone' | 'extension';
    hideHeader?: boolean;
    hideControlPanel?: boolean;
    hideSidebar?: boolean;
    externalSearch?: { term: string; id: number } | null;
    onExternalSearchConsumed?: (id: number) => void;
    onNodeNavigate?: (node: GraphNode) => void;
    renderEvidencePopup?: (selectedLink: GraphLink | null, onClose: () => void) => React.ReactNode;
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
                        className="bg-slate-800/80 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 w-32 transition-all"
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
                            const url = new URL(window.location.origin);
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
    hideHeader = false,
    hideControlPanel = false,
    hideSidebar = false,
    externalSearch = null,
    onExternalSearchConsumed,
    onNodeNavigate,
    renderEvidencePopup
}) => {
    const ENABLE_WEB_SEARCH = String((import.meta as any)?.env?.VITE_ENABLE_WEB_SEARCH || '').trim().toLowerCase() === 'true' || (import.meta as any)?.env?.VITE_ENABLE_WEB_SEARCH === '1';
    const ENABLE_ACADEMIC_CORPORA = (import.meta as any)?.env?.VITE_ENABLE_ACADEMIC_CORPORA !== 'false' && (import.meta as any)?.env?.VITE_ENABLE_ACADEMIC_CORPORA !== '0';

    const cacheBaseUrl = getEnvCacheUrl();
    const cacheEnabled = !!cacheBaseUrl;

    const {
        isAdminMode, kioskDomains, setKioskDomains, selectedKioskDomainId, setSelectedKioskDomainId,
        selectedKioskDomain, kioskSeedTerms
    } = useKioskMode();

    const state = useGraphState({ cacheEnabled, cacheBaseUrl });
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
        searchMode, setSearchMode, loadNodeImage, handleFindBetterImage, saveCacheNodeMeta
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
        showControlPanel: !hideControlPanel, selectedKioskDomain, graphRef
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
        pathStart, pathEnd, isCompact, isTimelineMode, isTextOnly
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

    useEffect(() => {
        if (!externalSearch?.term) return;
        handleStartSearch(externalSearch.term);
        if (externalSearch?.id !== undefined) onExternalSearchConsumed?.(externalSearch.id);
    }, [externalSearch?.id, handleStartSearch, onExternalSearchConsumed]);

    useEffect(() => {
        const handlePopState = () => {
            const params = new URLSearchParams(window.location.search);
            setPeopleBrowserOpen(params.get('browse') === 'people');
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [setPeopleBrowserOpen]);

    // Auto-start search if ?q= parameter is present in URL
    const urlQueryProcessedRef = useRef(false);
    useEffect(() => {
        if (urlQueryProcessedRef.current) return;

        const params = new URLSearchParams(window.location.search);
        const queryParam = params.get('q');
        if (queryParam && isKeyReady && nodes.length === 0) {
            urlQueryProcessedRef.current = true;
            handleStartSearch(queryParam);
        }
    }, [isKeyReady, nodes.length, handleStartSearch]);

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
            <div className="flex flex-col items-center justify-center w-screen h-screen bg-slate-900 text-white space-y-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">Constellations</h1>
                <button onClick={async () => { if ((window as any).aistudio) { await (window as any).aistudio.openSelectKey(); setIsKeyReady(true); } }} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105">
                    <Key size={20} className="inline mr-2" /> Select API Key
                </button>
            </div>
        );
    }

    return (
        <div className="w-screen h-screen bg-slate-950 overflow-hidden font-sans text-slate-200 selection:bg-indigo-500/30">
            {hideControlPanel && (
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
                isExtension={hideControlPanel}
                onOpenPeopleBrowser={handleOpenPeopleBrowser}
            />
            <AppHeader
                showHeader={!hideHeader}
                panelCollapsed={panelCollapsed}
                setPanelCollapsed={setPanelCollapsed}
                showBrowse={peopleBrowserOpen}
                handleOpenPeopleBrowser={handleOpenPeopleBrowser}
                selectedNode={selectedNode}
                sidebarCollapsed={sidebarCollapsed}
                setSidebarCollapsed={setSidebarCollapsed}
                setSidebarToggleSignal={setSidebarToggleSignal}
                onReset={handleClear}
            />

            <div className={`relative w-full h-full transition-all duration-500 ease-in-out ${!hideHeader ? 'pt-14' : ''}`}>
                <Graph
                    ref={graphRef}
                    nodes={nodes}
                    links={links}
                    onNodeClick={onNodeClick}
                    onLinkClick={(link) => { setSelectedLink(link); setSelectedNode(null); setContextMenu(null); }}
                    width={dimensions.width}
                    height={dimensions.height}
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
                        onClear={handleClear}
                        onClearCache={cacheEnabled ? handleClearCache : undefined}
                        onToggleHelp={() => setShowHelp(!showHelp)}
                        showHelp={showHelp}
                        onExpandAllLeafNodes={handleExpandAllLeafNodes}
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
                        onLoad={(name) => handleLoadGraph(name, applyGraphData)}
                        onDeleteGraph={handleDeleteGraph}
                        onImport={(e) => handleImport(e, applyGraphData)}
                        savedGraphs={savedGraphs}
                        helpHover={helpHover}
                        onHelpHoverChange={setHelpHover}
                        isCollapsed={panelCollapsed}
                        onSetCollapsed={setPanelCollapsed}
                        onOpenPeopleBrowser={handleOpenPeopleBrowser}
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
                    />
                )}

                {renderEvidencePopup && renderEvidencePopup(selectedLink, () => setSelectedLink(null))}

                <Suspense fallback={null}>
                    <PeopleBrowserSidebar
                        isOpen={peopleBrowserOpen}
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

                {contextMenu && (
                    <NodeContextMenu
                        node={contextMenu.node}
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onExpandLeaves={handleExpandLeaves}
                        onAddMore={handleExpandMore}
                        onFindBetterPhoto={handleFindBetterImage}
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

        </div>
    );
};

export default App;
