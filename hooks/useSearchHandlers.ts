import React, { useState, useCallback } from 'react';
import { GraphNode, GraphLink } from '../types';
import { classifyStartPair, fetchConnectionPath, LockedPair, classifyEntity } from '../services/geminiService';
import { fetchWikipediaSummary } from '../services/wikipediaService';
import { dedupeGraph } from '../services/graphUtils';
import { clampToViewport } from '../utils/graphLogicUtils';

interface PathResponse {
    path: any[];
    found: boolean;
}

interface UseSearchHandlersOptions {
    graphDataRef: React.MutableRefObject<{ nodes: GraphNode[], links: GraphLink[] }>;
    setGraphData: React.Dispatch<React.SetStateAction<{ nodes: GraphNode[], links: GraphLink[] }>>;
    setIsProcessing: (val: boolean) => void;
    setError: (val: string | null) => void;
    setSearchId: (id: number | ((prev: number) => number)) => void;
    searchIdRef: React.MutableRefObject<number>;
    setLockedPair: (pair: LockedPair) => void;
    dimensions: { width: number, height: number };
    cacheEnabled: boolean;
    cacheBaseUrl: string;
    loadNodeImage: (nodeId: number, title: string) => Promise<void>;
    fetchAndExpandNode: (node: GraphNode, isInitial?: boolean, forceMore?: boolean, nodesOverride?: GraphNode[], linksOverride?: GraphLink[]) => Promise<void>;
    setNotification: (notif: { message: string, type: 'success' | 'error' } | null) => void;
    setSelectedNode: (node: GraphNode | null) => void;
    setSelectedLink: (link: GraphLink | null) => void;
    setPathNodeIds: (ids: number[]) => void;
    setPendingAutoExpandId: (id: number | null) => void;
    showControlPanel: boolean;
    selectedKioskDomain: any;
    graphRef: React.RefObject<any>;
}

export function useSearchHandlers(options: UseSearchHandlersOptions) {
    const {
        graphDataRef, setGraphData, setIsProcessing, setError,
        setSearchId, searchIdRef, setLockedPair, dimensions,
        cacheEnabled, cacheBaseUrl, loadNodeImage, fetchAndExpandNode,
        setNotification, setSelectedNode, setSelectedLink, setPathNodeIds,
        setPendingAutoExpandId, showControlPanel, selectedKioskDomain, graphRef
    } = options;

    const [exploreTerm, setExploreTerm] = useState('');
    const [pathStart, setPathStart] = useState('');
    const [pathEnd, setPathEnd] = useState('');

    const upsertNodeLocal = useCallback(async (title: string, type: string, description: string, wiki: any) => {
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
    }, [cacheEnabled, cacheBaseUrl]);

    const handleStartSearch = useCallback(async (term: string, recursiveDepth = 0) => {
        setIsProcessing(true);
        setError(null);
        const nextSearchId = searchIdRef.current + 1;
        searchIdRef.current = nextSearchId;
        setSearchId(nextSearchId);
        setPathNodeIds([]);
        setSelectedLink(null);

        try {
            const startC = await classifyStartPair(term);
            const chosenPair: LockedPair = { atomicType: startC.atomicType, compositeType: startC.compositeType };
            setLockedPair(chosenPair);
            let { type, description, isAtomic, reasoning } = startC;

            const wikiContext = showControlPanel ? selectedKioskDomain?.label : undefined;
            const wiki = await fetchWikipediaSummary(term, wikiContext);
            const canonicalTitle = (wiki.title || term).trim();
            const lowerCanon = canonicalTitle.toLowerCase();
            const safeExploreTerm = (lowerCanon.startsWith('list of ') || lowerCanon.includes('awards and nominations') || lowerCanon.includes('filmography') || lowerCanon.includes('discography'))
                ? term
                : canonicalTitle;
            setExploreTerm(safeExploreTerm);

            const { id: nodeId } = await upsertNodeLocal(canonicalTitle, type, description || '', wiki);

            const startNode: GraphNode = {
                id: nodeId, title: canonicalTitle, type, is_atomic: isAtomic,
                wikipedia_id: wiki.pageid?.toString(),
                description: wiki.extract || description || '',
                x: dimensions.width / 2, y: dimensions.height / 2, expanded: false,
                wikiSummary: wiki.extract || undefined,
                classification_reasoning: reasoning,
                atomic_type: chosenPair.atomicType, composite_type: chosenPair.compositeType
            };

            setGraphData({ nodes: [startNode], links: [] });
            setSelectedNode(startNode);
            loadNodeImage(startNode.id, startNode.title);
            await fetchAndExpandNode(startNode, true, false, [startNode], []);

            if (recursiveDepth > 0) setPendingAutoExpandId(startNode.id);
        } catch (e) {
            console.error("Search error:", e);
            setError("Search failed.");
        } finally {
            setIsProcessing(false);
        }
    }, [dimensions, cacheEnabled, cacheBaseUrl, setGraphData, setIsProcessing, setError, setSearchId, searchIdRef, setLockedPair, loadNodeImage, fetchAndExpandNode, setSelectedNode, setSelectedLink, setPathNodeIds, setPendingAutoExpandId, showControlPanel, selectedKioskDomain, upsertNodeLocal]);

    const handlePathSearch = useCallback(async (start: string, end: string) => {
        setIsProcessing(true);
        setError(null);
        setNotification({ message: `Exploring "${start}" and "${end}"...`, type: 'success' });

        const nextSearchId = searchIdRef.current + 1;
        searchIdRef.current = nextSearchId;
        setSearchId(nextSearchId);
        setPathNodeIds([]);
        setSelectedLink(null);

        try {
            const [startWiki, endWiki, startC, endC] = await Promise.all([
                fetchWikipediaSummary(start),
                fetchWikipediaSummary(end),
                classifyEntity(start),
                classifyEntity(end)
            ]);

            const [startNodeData, endNodeData] = await Promise.all([
                upsertNodeLocal(start, startC.type, startC.description || '', startWiki),
                upsertNodeLocal(end, endC.type, endC.description || '', endWiki)
            ]);

            const startNode: GraphNode = {
                id: startNodeData.id, title: start.trim(), type: startC.type, is_atomic: startC.isAtomic,
                wikipedia_id: startWiki.pageid?.toString(), description: startWiki.extract || startC.description || '',
                x: dimensions.width / 4, y: dimensions.height / 2, fx: dimensions.width / 4, fy: dimensions.height / 2,
                expanded: false, wikiSummary: startWiki.extract || undefined
            };

            const endNode: GraphNode = {
                id: endNodeData.id, title: end.trim(), type: endC.type, is_atomic: endC.isAtomic,
                wikipedia_id: endWiki.pageid?.toString(), description: endWiki.extract || endC.description || '',
                x: (dimensions.width * 3) / 4, y: dimensions.height / 2, fx: (dimensions.width * 3) / 4, fy: dimensions.height / 2,
                expanded: false, wikiSummary: endWiki.extract || undefined
            };

            setGraphData({ nodes: [startNode, endNode], links: [] });
            setSelectedNode(startNode);
            loadNodeImage(startNode.id, startNode.title);
            loadNodeImage(endNode.id, endNode.title);

            let pathData: PathResponse | null = null;
            let usingDatabase = false;

            if (cacheEnabled) {
                try {
                    const res = await fetch(new URL(`/path?startId=${startNode.id}&endId=${endNode.id}&maxDepth=10`, cacheBaseUrl).toString());
                    if (res.ok) {
                        const dbPath = await res.json();
                        if (dbPath.found && dbPath.path && dbPath.path.length >= 2) {
                            pathData = { path: dbPath.path, found: true };
                            (pathData as any)._dbPath = true;
                            usingDatabase = true;
                        }
                    }
                } catch (e) { }
            }

            if (!pathData) {
                setNotification({ message: "Finding hidden connections...", type: 'success' });
                pathData = await fetchConnectionPath(start, end, { startWiki: startWiki.extract || undefined, endWiki: endWiki.extract || undefined });
            }

            if (!pathData || !pathData.path || pathData.path.length < 2) {
                setError("No path found.");
                return;
            }

            const isDbPath = (pathData as any)._dbPath === true;
            const pathNodeIdsList: number[] = [];
            let currentTailId = startNode.id;

            if (isDbPath) {
                const dbNodes = pathData.path as any[];
                dbNodes.forEach(n => pathNodeIdsList.push(n.id));
                setGraphData(current => {
                    const updatedNodes = [...current.nodes];
                    const updatedLinks = [...current.links];
                    dbNodes.forEach((dbNode, i) => {
                        let existingNode = updatedNodes.find(n => n.id === dbNode.id);
                        if (!existingNode) {
                            const nodeX = i === 0 ? (startNode.x || dimensions.width / 4) : (updatedNodes[i - 1]?.x || dimensions.width / 2) + (Math.random() - 0.5) * 150;
                            const nodeY = i === 0 ? (startNode.y || dimensions.height / 2) : (updatedNodes[i - 1]?.y || dimensions.height / 2) + (Math.random() - 0.5) * 150;
                            const clamped = clampToViewport(nodeX, nodeY, 80);
                            existingNode = { id: dbNode.id, title: dbNode.title, type: dbNode.type, x: clamped.x, y: clamped.y, fx: clamped.x, fy: clamped.y, expanded: false, ...dbNode };
                            updatedNodes.push(existingNode);
                            loadNodeImage(dbNode.id, existingNode.title);
                        }
                    });
                    for (let i = 0; i < dbNodes.length - 1; i++) {
                        const a = dbNodes[i].id;
                        const b = dbNodes[i + 1].id;
                        if (!updatedLinks.some(l => (l.source === a && l.target === b) || (l.source === b && l.target === a))) {
                            updatedLinks.push({ source: a, target: b, id: `${a}-${b}` });
                        }
                    }
                    return dedupeGraph(updatedNodes, updatedLinks);
                });
            } else {
                pathNodeIdsList.push(startNode.id);
                for (let i = 1; i < pathData.path.length; i++) {
                    const step = pathData.path[i];
                    setNotification({ message: `Stitching path... step ${i} of ${pathData.path.length - 1}: ${step.id}`, type: 'success' });
                    const stepWiki = await fetchWikipediaSummary(step.id);
                    const { id: resolvedId } = await upsertNodeLocal(step.id, step.type, step.description, stepWiki);
                    if (!pathNodeIdsList.includes(resolvedId)) pathNodeIdsList.push(resolvedId);

                    setGraphData(current => {
                        const tailNode = current.nodes.find(n => n.id === currentTailId);
                        const clamped = clampToViewport((tailNode?.x || 400) + (Math.random() - 0.5) * 150, (tailNode?.y || 400) + (Math.random() - 0.5) * 150, 80);
                        const newNode: GraphNode = { id: resolvedId, title: step.id, type: step.type, description: step.description, x: clamped.x, y: clamped.y, fx: clamped.x, fy: clamped.y, expanded: false, wikipedia_id: stepWiki.pageid?.toString() };
                        const updatedNodes = current.nodes.some(n => n.id === resolvedId) ? current.nodes.map(n => n.id === resolvedId ? newNode : n) : [...current.nodes, newNode];
                        const updatedLinks = [...current.links, { source: currentTailId, target: resolvedId, id: `${currentTailId}-${resolvedId}` }];
                        loadNodeImage(resolvedId, newNode.title);
                        setTimeout(() => fetchAndExpandNode(newNode), 0);
                        return { nodes: updatedNodes, links: updatedLinks };
                    });
                    currentTailId = resolvedId;
                }
                if (!pathNodeIdsList.includes(endNode.id)) pathNodeIdsList.push(endNode.id);
            }

            await new Promise(r => setTimeout(r, 300));
            const nodeIdsInGraph = new Set(graphDataRef.current.nodes.map(n => n.id));
            const finalPathIds = pathNodeIdsList.filter(id => nodeIdsInGraph.has(id));

            setGraphData(current => ({
                ...current,
                nodes: current.nodes.map(n => ({ ...n, fx: null, fy: null }))
            }));
            setPathNodeIds([...finalPathIds]);
            setNotification({ message: "Path discovery complete!", type: 'success' });
            if (finalPathIds.length) setTimeout(() => graphRef.current?.centerOnNode(finalPathIds[Math.floor(finalPathIds.length / 2)]), 200);

        } catch (e) {
            console.error("Path error:", e);
            setError("Path search failed.");
        } finally {
            setIsProcessing(false);
        }
    }, [dimensions, cacheEnabled, cacheBaseUrl, setGraphData, setIsProcessing, setError, setSearchId, searchIdRef, setNotification, loadNodeImage, fetchAndExpandNode, setSelectedNode, setPathNodeIds, graphRef, upsertNodeLocal]);

    return { exploreTerm, setExploreTerm, pathStart, setPathStart, pathEnd, setPathEnd, handleStartSearch, handlePathSearch };
}
