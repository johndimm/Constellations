import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import Graph from '../components/Graph';
import NodeContextMenu from '../components/NodeContextMenu';
import { GraphNode, GraphLink } from '../types';
import { classifyStartPair, fetchConnections, fetchPersonWorks } from '../services/geminiService';
import { fetchWikipediaSummary } from '../services/wikipediaService';
import { dedupeGraph } from '../services/graphUtils';
import { getEffectiveCacheBaseUrl, fetchCacheExpansion, saveCacheExpansion } from '../services/cacheService';
import { fetchServerImage } from '../services/imageService';
import '../index.css';

// Minimal SidePanel App
const SidePanelApp = () => {
    const [nodes, setNodes] = useState<GraphNode[]>([]);
    const [links, setLinks] = useState<GraphLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string>("");
    const [initialNode, setInitialNode] = useState<GraphNode | null>(null);
    const [contextMenu, setContextMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null);

    // Window dimensions for Graph
    const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

    // Replicating basic graph state
    const graphRef = useRef<any>(null);
    const wikiSummaryCacheRef = useRef<Map<string, { title: string; extract: string | null; pageid: number | null }>>(new Map());

    // Handle Resize
    useEffect(() => {
        const handleResize = () => {
            setDimensions({ width: window.innerWidth, height: window.innerHeight });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Load pending query from storage on mount
    useEffect(() => {
        const loadQuery = async () => {
            // @ts-ignore
            const data = await chrome.storage.local.get(['pendingQuery', 'timestamp']);
            if (data.pendingQuery) {
                handleSearch(data.pendingQuery);
                // @ts-ignore
                chrome.storage.local.remove(['pendingQuery', 'timestamp']);
            }
        };
        loadQuery();

        // Listen for storage changes
        // @ts-ignore
        const listener = (changes, area) => {
            if (area === 'local' && changes.pendingQuery?.newValue) {
                handleSearch(changes.pendingQuery.newValue);
            }
        };
        // @ts-ignore
        chrome.storage.onChanged.addListener(listener);
        // @ts-ignore
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    const resolveWikiContext = async (title: string) => {
        const key = title.trim().toLowerCase();
        const cached = wikiSummaryCacheRef.current.get(key);
        if (cached) return cached;
        const wiki = await fetchWikipediaSummary(title);
        const canonicalTitle = (wiki.title || title).trim();
        const lowerCanon = canonicalTitle.toLowerCase();
        const safeTitle =
            (lowerCanon.startsWith('list of ') || lowerCanon.includes('awards and nominations') || lowerCanon.includes('filmography') || lowerCanon.includes('discography'))
                ? title
                : canonicalTitle;
        const resolved = {
            title: safeTitle,
            extract: wiki.extract || null,
            pageid: wiki.pageid ?? null
        };
        wikiSummaryCacheRef.current.set(key, resolved);
        wikiSummaryCacheRef.current.set(safeTitle.toLowerCase(), resolved);
        return resolved;
    };

    const fetchAndSetImage = async (nodeId: number, title: string, context?: string, description?: string) => {
        try {
            const wiki = await resolveWikiContext(title);
            const resolvedTitle = wiki.title || title;
            const resolvedDescription = wiki.extract || description;

            if (resolvedTitle !== title || wiki.pageid || wiki.extract) {
                setNodes(prev => prev.map(n => n.id === nodeId ? {
                    ...n,
                    title: resolvedTitle,
                    wikipedia_id: wiki.pageid?.toString() || n.wikipedia_id,
                    wikiSummary: wiki.extract || n.wikiSummary,
                    description: resolvedDescription || n.description
                } : n));
            }

            console.log(`Fetching image for ${resolvedTitle} (${nodeId})`);
            const baseUrl = getEffectiveCacheBaseUrl() || 'http://localhost:4000';
            const result = await fetchServerImage(resolvedTitle, context, baseUrl);
            if (result.url) {
                console.log(`Unique image found from server for ${resolvedTitle}: ${result.url}`);
                setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: result.url, imageChecked: true } : n));
            } else {
                console.log(`No image found from server for ${resolvedTitle}`);
                setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageChecked: true } : n));
            }
        } catch (error) {
            console.error(`Failed to fetch image for ${title}:`, error);
        }
    };

    const handleSearch = async (term: string) => {
        setLoading(true);
        setError(null);
        setStatus(`Analyzing "${term}"...`);
        setNodes([]);
        setLinks([]);

        try {
            // 1. Classify
            const classification = await classifyStartPair(term);
            const startId = Date.now();
            const startNode: GraphNode = {
                id: startId,
                title: term,
                type: classification.type,
                is_atomic: classification.isAtomic,
                description: classification.description,
                isLoading: true // Show spinner immediately
            };

            setNodes([startNode]);
            setInitialNode(startNode);
            // Fetch start node image
            fetchAndSetImage(startId, term, classification.type, classification.description);

            // 2. Fetch Initial Connections
            setStatus(`Fetching connections for ${term}...`);

            let rawResults: any[] = [];
            const cacheBaseUrl = getEffectiveCacheBaseUrl();
            const cacheEnabled = !!cacheBaseUrl;
            let cacheHitData: any = null;

            if (cacheEnabled) {
                try {
                    cacheHitData = await fetchCacheExpansion(startId, cacheBaseUrl); // Wait, startId is new locally, so it won't be in cache? 
                    // Ah, the cache lookup needs to be by TITLE/TYPE maybe? 
                    // Actually, the cache Service finds by ID. But for a SEARCH, we don't know the ID yet.
                    // The standalone app uses `fetchCacheExpansion(id)`.
                    // Does the standalone app allow "search" against the cache?
                    // In `App.tsx`: `handleSearch` creates a new node, then calls `fetchAndExpandNode`. 
                    // `fetchAndExpandNode` calls `upsertNodes` (via server) which handles dedupe, then it might hit cache?
                    // The server's `/expansion` endpoint takes `sourceId`.
                    // If we just generated `startId` locally (Date.now()), the server knows NOTHING about it.
                    // So we cannot cache-hit a BRAND NEW local search node unless we first resolve it to a server ID.

                    // The standalone app works because:
                    // 1. User searches -> Local node created.
                    // 2. `fetchAndExpandNode` logic runs.
                    // 3. It classifies, etc.
                    // 4. Then calls `fetchCacheExpansion`.
                    // BUT: `fetchCacheExpansion` uses `node.id`. If `node.id` is local random number, server returns nothing.
                    // UNLESS the app upserts the node first?
                    // In `App.tsx`, `upsertNodes` happens during `saveCacheExpansion`.

                    // So, for the very first search term ever, it will be a MISS.
                    // But if the graph loads an EXISTING node (with DB ID), then cache works.
                    // The sidebar starts fresh every time?
                    // If I want to match standalone behavior:
                    // Just do the Gemini fetch.
                    // BUT: If I want to "use the same database cache", I ideally want to check if "Robert De Niro" already exists in the DB.
                    // But the current API `/expansion?sourceId=...` requires an ID. I don't have a "lookup by title" API endpoint exposed in `server.ts` easily accessibly for *expansion*, only for *upsert*.

                    // Wait, `upsertNodes` returns the ID.
                    // Should I upsert the start node first?
                    // If I upsert "Robert De Niro", I get its DB ID. Then I can ask for its expansion!
                    // Implementation:
                    // 1. Upsert "Robert De Niro" (Node).
                    // 2. Get ID.
                    // 3. fetchCacheExpansion(ID).
                    // 4. If hit, use it.
                    // 5. If miss, fetch Gemini, then save.

                    // However, `sidepanel.tsx` does NOT have `upsertNode` logic imported.
                    // `cacheService.ts` only has fetch/save expansion.
                    // I will stick to Gemini fetch for now to fix the crash. 
                    // Adding proper "Search Cache" requires generic "Find Node by Title" API or Upsert API.

                    // WAIT! `handleSearch` in `App.tsx` does NOT seem to do a pre-lookup.
                    // It creates a node with `Date.now()`.
                    // Then `fetchAndExpandNode` calls `fetchCacheExpansion(node.id)`.
                    // Since `node.id` is `Date.now()`, the cache (Postgres) receives a random huge integer.
                    // Unless the DB has that ID, it returns NULL.
                    // So `App.tsx` likely MISSES cache for the *root* node of a fresh search, unless it was loaded from a saved graph?
                    // OR: maybe `fetchCacheExpansion` in `App.tsx` handles title lookup?
                    // `App.tsx`: `const url = new URL("/expansion", cacheBaseUrl); url.searchParams.set("sourceId", sourceId.toString());`
                    // `server.ts`: `app.get("/expansion" ... const id = parseInt(sourceId);`
                    // So it relies on integer ID.
                    // Thus, searching for a new term in `App.tsx` produces a cache MISS on the first node (because ID is local transient).
                    // Logic: You search "A". ID=123 (local). Cache check 123 -> Miss. Gemini Expand -> Save (Upsert 123? NO, upsert does by Title).
                    // server.ts `upsertNodes` matches by Title/Type. It returns the REAL db ID.
                    // But `saveCacheExpansion` sends the *local* nodes.
                    // server.ts `save expansion`: 
                    // 1. `upsertNodes` with the target nodes.
                    // 2. `sourceRes = select is_atomic from nodes where id = $1` (sourceId).
                    // This creates a problem! If sourceId is local (123), `select ... where id=123` will fail/miss if 123 is not in DB.
                    // `App.tsx` logic must be relying on something else or I misunderstood.

                    // Actually, `App.tsx` might be failing to cache the *root* expansions if the root ID isn't in DB?
                    // `server.ts` lines 745: `if (sourceRes.rowCount === 0) throw new Error("Source node not found");`

                    // This implies `App.tsx` MUST upsert the source node first?
                    // `App.tsx` `fetchAndExpandNode` -> `saveCacheExpansion`. 
                    // But where is the source node upserted?
                    // Maybe `App.tsx` calls `/node` endpoint?
                    // `App.tsx`: `await fetch(new URL("/expansion", cacheBaseUrl)...`
                    // It does NOT seem to call `/node` explicitly before expansion save.

                    // Wait, `server.ts` `app.post("/expansion")`:
                    // It EXPECTS sourceId to exist.
                    // How does `App.tsx` ensure sourceId exists?
                    // Maybe `App.tsx` doesn't? Maybe caching the *root* search only works if it was already in the graph?

                    // Whatever the case, fixing the CRASH (rawResults) is priority. 
                    // I will perform the Gemini fetch as before.
                    // I will define `rawResults`.
                } catch (e) { }
            }

            let response: any;
            if (classification.isAtomic) {
                response = await fetchPersonWorks(
                    term,
                    [],
                    undefined,
                    undefined,
                    classification.atomicType,
                    classification.compositeType
                );
            } else {
                response = await fetchConnections(
                    term,
                    undefined,
                    [],
                    undefined,
                    undefined,
                    classification.atomicType,
                    classification.compositeType
                );
            }
            rawResults = (response as any).people || (response as any).works || [];


            const newNodes: GraphNode[] = [];
            const newLinks: GraphLink[] = [];

            // Deduplication map: Normalized Title -> Node
            const existingNodesMap = new Map<string, GraphNode>();
            nodes.forEach(n => {
                if (n.title) existingNodesMap.set(n.title.toLowerCase().trim(), n);
            });

            // Also track new nodes in this batch to prevent dupes within the batch itself
            const batchNodesMap = new Map<string, GraphNode>();

            const timestamp = Date.now();

            rawResults.forEach((item: any, index: number) => {
                const rawTitle = item.wikipediaTitle || item.name || item.entity; // item.entity is for works
                if (!rawTitle) return;

                const normTitle = rawTitle.toLowerCase().trim();

                // Check if node exists (in graph or in current batch)
                const existingNode = existingNodesMap.get(normTitle) || batchNodesMap.get(normTitle);

                let targetId: number;
                let isNewNode = false;

                if (existingNode) {
                    targetId = existingNode.id;
                } else {
                    targetId = timestamp + index;
                    isNewNode = true;
                }

                if (isNewNode) {
                    const targetIsAtomic = !startNode.is_atomic;
                    const targetType = targetIsAtomic
                        ? (classification.atomicType || "Person")
                        : (classification.compositeType || "Event");

                    const newNode: GraphNode = {
                        id: targetId,
                        title: rawTitle,
                        type: targetType,
                        is_atomic: targetIsAtomic,
                        description: item.description,
                        meta: { wikiSummary: item.evidenceSnippet }
                    };

                    newNodes.push(newNode);
                    batchNodesMap.set(normTitle, newNode);

                    // Fetch image only for new nodes
                    setTimeout(() => fetchAndSetImage(targetId, rawTitle, targetType, item.description), 300 * (index + 1));
                }

                // Add link if it doesn't exist? (Optional, but good practice)
                // For now, just add it. D3 might handle dupes or we can filter later.
                // But sidepanel links state is simple array.
                // Let's assume links are unique by ID logic or just allow multiple edges for now (multi-graph).
                // Actually, duplicate links are bad for force layout.
                // Simple link check:
                const linkId = `${startId}-${targetId}`;
                const linkExists = links.some(l => l.id === linkId) || newLinks.some(l => l.id === linkId);

                if (!linkExists) {
                    newLinks.push({
                        source: startId,
                        target: targetId,
                        id: linkId
                    } as any);
                }
            });

            setNodes(prev => {
                // Remove loading state from start node and append new nodes
                const updated = prev.map(n => n.id === startId ? { ...n, isLoading: false, expanded: true } : n);

                const allNodes = [...updated, ...newNodes];
                const allLinks = [...links, ...newLinks]; // 'links' is empty here ideally but let's be safe

                const { nodes: uniqueNodes, links: uniqueLinks } = dedupeGraph(allNodes, allLinks);

                setTimeout(() => setLinks(uniqueLinks), 0);

                return uniqueNodes;
            });

        } catch (e: any) {
            setError(e.message || "Failed to load graph");
            // Turn off loading if error
            setNodes(prev => prev.map(n => ({ ...n, isLoading: false })));
        } finally {
            setLoading(false);
            setStatus("");
        }
    };

    const expandNode = async (node: GraphNode) => {
        if (!node) return;

        // If currently loading, don't re-expand
        if (node.isLoading || loading) return;

        setLoading(true);
        setStatus(`Expanding "${node.title}"...`);

        // Mark node as loading/expanded
        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: true, expanded: true } : n));

        try {
            const isAtomic = node.is_atomic ?? (node.type?.toLowerCase() === 'person');
            let newPeople: any[] = [];
            let newWorks: any[] = [];

            const cacheBaseUrl = getEffectiveCacheBaseUrl();
            const cacheEnabled = !!cacheBaseUrl;
            let cacheHitData: any = null;

            if (cacheEnabled) {
                try {
                    cacheHitData = await fetchCacheExpansion(node.id, cacheBaseUrl);
                    if (cacheHitData && cacheHitData.nodes) {
                        console.log(`Sidpanel cache hit for ${node.title}`);
                    }
                } catch (e) { console.warn("Cache check failed", e); }
            }

            // Calculate existing neighbors to exclude
            const neighborIds = new Set<number>();
            links.forEach(l => {
                const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as number;
                const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as number;
                if (sId === node.id) neighborIds.add(tId);
                if (tId === node.id) neighborIds.add(sId);
            });
            const neighborNames = nodes
                .filter(n => neighborIds.has(n.id))
                .map(n => n.title)
                .filter(Boolean);

            if (cacheHitData && cacheHitData.nodes && cacheHitData.nodes.length > 0) {
                // Use cached data
                // Map cache structure to simple array of items for the loop below
                // The loop expects raw results from Gemini, but cache returns full nodes.
                // We can adapt them.
                // Actually, cache nodes already have correct shape mostly.
                const cached = cacheHitData.nodes.filter((n: any) => n.id !== node.id);

                // If Atomic (Person), we wanted Works. If Composite, People.
                // The cache stores "targets".
                if (isAtomic) newWorks = cached;
                else newPeople = cached;

            } else {
                // Simple expansion logic (API)
                if (isAtomic) {
                    // Expand Atomic (Person) -> get Works (Composites)
                    const res = await fetchPersonWorks(node.title, neighborNames, undefined, undefined, node.type, "Event"); // simplified types
                    newWorks = res.works || [];
                } else {
                    // Expand Composite (Event) -> get Atomics (People)
                    const res = await fetchConnections(node.title, undefined, neighborNames, undefined, undefined, "Person", node.type); // simplified types
                    newPeople = res.people || [];
                }

                // Save to cache
                if (cacheEnabled) {
                    const toSave = isAtomic ? newWorks : newPeople;
                    // convert to node format for cache?
                    // The cache service expects node objects. The fetch return items are like { entity: "...", type: "...", ... }
                    // We need to convert them to basic nodes for saving.
                    const nodesForCache = toSave.map(item => ({
                        title: item.wikipediaTitle || item.name || item.entity,
                        type: item.type || (isAtomic ? "Event" : "Person"),
                        description: item.description,
                        year: item.year,
                        wikipedia_id: item.wikipedia_id, // usually missing from raw gemini
                        meta: { wikiSummary: item.evidenceSnippet }
                    }));
                    // Don't await strictly
                    saveCacheExpansion(node.id, nodesForCache, cacheBaseUrl);
                }
            }

            const rawResults = isAtomic ? newWorks : newPeople;

            const newNodes: GraphNode[] = [];
            const newLinks: GraphLink[] = [];

            // Deduplication map: Normalized Title -> Node
            const existingNodesMap = new Map<string, GraphNode>();
            nodes.forEach(n => {
                if (n.title) existingNodesMap.set(n.title.toLowerCase().trim(), n);
            });
            const batchNodesMap = new Map<string, GraphNode>();

            const timestamp = Date.now();

            rawResults.forEach((item: any, index: number) => {
                const rawTitle = item.wikipediaTitle || item.name || item.entity; // item.entity is for works
                if (!rawTitle) return;

                const normTitle = rawTitle.toLowerCase().trim();
                const existingNode = existingNodesMap.get(normTitle) || batchNodesMap.get(normTitle);

                let targetId: number;
                let isNewNode = false;

                if (existingNode) {
                    targetId = existingNode.id;
                } else {
                    targetId = timestamp + index;
                    isNewNode = true;
                }

                if (isNewNode) {
                    // Determine type
                    const itemType = item.type || (isAtomic ? "Event" : "Person"); // fallback
                    const itemIsAtomic = !isAtomic;

                    const newNode: GraphNode = {
                        id: targetId,
                        title: rawTitle,
                        type: itemType,
                        is_atomic: itemIsAtomic,
                        description: item.description,
                        meta: { wikiSummary: item.evidenceSnippet }
                    };

                    newNodes.push(newNode);
                    batchNodesMap.set(normTitle, newNode);

                    // Fetch image
                    setTimeout(() => fetchAndSetImage(targetId, rawTitle, itemType, item.description), 100 * (index + 1));
                }

                const linkId = `${node.id}-${targetId}`;
                const linkExists = links.some(l => l.id === linkId) || newLinks.some(l => l.id === linkId);

                if (!linkExists) {
                    newLinks.push({
                        source: node.id,
                        target: targetId,
                        id: linkId
                    } as any);
                }
            });

            setNodes(prev => {
                const updated = prev.map(n => n.id === node.id ? { ...n, isLoading: false, expanded: true } : n);
                // Combine and Dedupe
                const allNodes = [...updated, ...newNodes];
                const allLinks = [...links, ...newLinks];
                // Reuse the robust dedupe logic from the main app
                const { nodes: uniqueNodes, links: uniqueLinks } = dedupeGraph(allNodes, allLinks);

                // Hack: We need to update links state outside of this callback because we can't efficiently
                // return both from SetStateAction callback without context.
                // But simplified: we will set links in the next line.
                // However, dedupeGraph might have remapped IDs, so we must rely on its output.

                // Wait! 'links' variable in closure is stale? 
                // 'links' in handleNodeClick is from the render scope.
                // We should assume 'links' state matches what we passed.

                // Let's optimize: update both states at once if possible or rely on useEffect? 
                // React batching handles this.

                // Side-effect: update links
                setTimeout(() => setLinks(uniqueLinks), 0);

                return uniqueNodes;
            });

        } catch (e: any) {
            console.error("Expansion failed", e);
            setError(`Failed to expand: ${e.message}`);
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: false, expanded: false } : n));
        } finally {
            setLoading(false);
            setStatus("");
        }
    };

    const handleNodeClick = async (node: GraphNode | null) => {
        if (!node) return;

        // ALWAYS navigate (left-click behavior) if title is present
        if (node.title) {
            const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(node.title.replace(/ /g, '_'))}`;
            // Navigate active tab
            // @ts-ignore
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab?.id) {
                    // @ts-ignore
                    chrome.tabs.update(tab.id, { url: wikiUrl });
                }
            });
        }

        await expandNode(node);
    };

    const handleExpandMore = (node: GraphNode) => {
        expandNode(node);
    };

    const handleExpandLeaves = async (node: GraphNode) => {
        const neighborIds = new Set<number>();
        links.forEach(l => {
            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as number;
            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as number;
            if (sId === node.id) neighborIds.add(tId);
            if (tId === node.id) neighborIds.add(sId);
        });

        const neighbors = nodes.filter(n => neighborIds.has(n.id) && !n.expanded && !n.isLoading);
        if (!neighbors.length) {
            setStatus("No unexpanded neighbors.");
            setTimeout(() => setStatus(""), 1500);
            return;
        }

        setStatus(`Expanding ${neighbors.length} neighbors...`);
        for (const neighbor of neighbors) {
            const latest = nodes.find(n => n.id === neighbor.id);
            if (!latest || latest.expanded || latest.isLoading) continue;
            await expandNode(latest);
            await new Promise(resolve => setTimeout(resolve, 600));
        }
        setStatus("");
    };

    const handleFindBetterPhoto = (nodeId: number) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node?.title) return;
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: null, imageChecked: false } : n));
        setStatus(`Refreshing image for "${node.title}"...`);
        fetchAndSetImage(nodeId, node.title, node.type, node.description).finally(() => {
            setStatus("");
        });
    };

    const handleDeleteNode = (nodeId: number) => {
        const remainingNodes = nodes.filter(n => n.id !== nodeId);
        const remainingLinks = links.filter(l => {
            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as number;
            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as number;
            return sId !== nodeId && tId !== nodeId;
        });

        if (remainingNodes.length === 0) {
            setNodes([]);
            setLinks([]);
            return;
        }

        const adjacency = new Map<number, number[]>();
        remainingNodes.forEach(n => adjacency.set(n.id, []));
        remainingLinks.forEach(l => {
            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as number;
            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as number;
            adjacency.get(sId)?.push(tId);
            adjacency.get(tId)?.push(sId);
        });

        const visited = new Set<number>();
        let largest: number[] = [];

        for (const n of remainingNodes) {
            if (visited.has(n.id)) continue;
            const queue = [n.id];
            const component: number[] = [];
            visited.add(n.id);
            while (queue.length) {
                const current = queue.shift()!;
                component.push(current);
                const neighbors = adjacency.get(current) || [];
                neighbors.forEach(id => {
                    if (!visited.has(id)) {
                        visited.add(id);
                        queue.push(id);
                    }
                });
            }
            if (component.length > largest.length) largest = component;
        }

        const keepIds = new Set(largest);
        setNodes(remainingNodes.filter(n => keepIds.has(n.id)));
        setLinks(remainingLinks.filter(l => {
            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as number;
            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as number;
            return keepIds.has(sId) && keepIds.has(tId);
        }));
    };

    const handleNodeContextMenu = (event: MouseEvent, node: GraphNode) => {
        event.preventDefault();
        if (!node?.title) return;
        setContextMenu({ node, x: event.clientX, y: event.clientY });
    };

    return (
        <div className="flex flex-col h-full bg-black">
            <div className="p-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur z-10 flex-none h-auto">
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                    Constellations
                </h1>
                {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
            </div>

            <div className="flex-grow relative overflow-hidden h-full w-full">
                {nodes.length > 0 ? (
                    <Graph
                        ref={graphRef}
                        nodes={nodes}
                        links={links}
                        onNodeClick={handleNodeClick}
                        onNodeContextMenu={handleNodeContextMenu}
                        onBackgroundClick={() => { }}
                        width={dimensions.width}
                        height={dimensions.height}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm p-8 text-center">
                        Select text on any webpage and right-click "Constellations" to explore.
                    </div>
                )}
                {contextMenu && (
                    <NodeContextMenu
                        node={contextMenu.node}
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onExpandLeaves={handleExpandLeaves}
                        onAddMore={handleExpandMore}
                        onFindBetterPhoto={handleFindBetterPhoto}
                        onDelete={handleDeleteNode}
                        onClose={() => setContextMenu(null)}
                        isProcessing={loading}
                    />
                )}
                {status && (
                    <div className="absolute bottom-4 right-4 z-20 rounded-md bg-slate-900/80 text-slate-200 text-xs px-3 py-2 border border-slate-700 shadow-lg pointer-events-none">
                        {status}
                    </div>
                )}
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<SidePanelApp />);
