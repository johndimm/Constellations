"use client";
import React, { useState, useCallback } from 'react';
import { GraphNode, GraphLink } from '../types';
import { fetchConnections, fetchPersonWorks, classifyEntity, fetchOrgKeyPeopleBlockViaSearch, LockedPair } from '../services/aiService';
import { fetchWikipediaSummary, fetchWikipediaExtract, fetchWikidataKeyPeopleForTitle, fetchWikidataCastForTitle } from '../services/wikipediaService';
import {
    searchOpenAlexAuthor,
    getTopWorksForAuthor,
    openAlexWorkToPaperNode,
    makeOpenAlexAuthorshipEvidence,
    getOpenAlexWork,
    openAlexAuthorToAuthorNode,
    searchOpenAlexWork
} from '../services/openAlexService';
import { fetchCrossrefWorkByDoi, crossrefAuthors, makeCrossrefAuthorshipEvidence, crossrefWorkToPaperNode } from '../services/crossrefService';
import { dedupeGraph, mergeExpansionGraph, baseDedupeKey, normalizeForDedup } from '../services/graphUtils';
import { buildWikiUrl, looksLikeWikipediaTitle } from '../utils/wikiUtils';
import {
    normalizeForEvidence,
    splitIntoSentences,
    looksLikeSpecificPersonName,
    sanitizeEvidenceAndRole,
    isParenJobTitle,
    sanitizeTitleParen,
    roleLooksLikeJobTitle
} from '../utils/evidenceUtils';
import { getLinkKey, looksLikeScreenWork, isBadListPage } from '../utils/graphLogicUtils';

interface UseExpansionOptions {
    graphDataRef: React.MutableRefObject<{ nodes: GraphNode[], links: GraphLink[] }>;
    setGraphData: React.Dispatch<React.SetStateAction<{ nodes: GraphNode[], links: GraphLink[] }>>;
    setIsProcessing: (val: boolean) => void;
    setError: (val: string | null) => void;
    searchIdRef: React.MutableRefObject<number>;
    lockedPairRef: React.MutableRefObject<LockedPair>;
    nodesRef: React.MutableRefObject<GraphNode[]>;
    selectedNodeRef: React.MutableRefObject<GraphNode | null>;
    autoExpandMoreDoneRef: React.MutableRefObject<Set<string | number>>;
    cacheEnabled: boolean;
    cacheBaseUrl: string;
    ENABLE_ACADEMIC_CORPORA: boolean;
    ENABLE_WEB_SEARCH: boolean;
    loadNodeImage: (nodeId: number | string, title: string, context?: string, fallbackNode?: any, opts?: any) => Promise<void>;
    saveCacheNodeMeta: (nodeId: number | string, meta: any, fallbackNode?: any) => Promise<void>;
    setNewlyExpandedNodeIds: (ids: (number | string)[]) => void;
    setExpandingNodeId: (id: number | string | null) => void;
    setNewChildNodeIds: (ids: Set<string | number> | ((prev: Set<string | number>) => Set<string | number>)) => void;
    setSelectedNode: (node: GraphNode | null) => void;
    setSelectedLink: (link: GraphLink | null) => void;
    exploreTerm: string;
    isTextOnly: boolean;
    graphRef: React.RefObject<any>;
}

export function useExpansion(options: UseExpansionOptions) {
    const {
        graphDataRef, setGraphData, setIsProcessing, setError,
        searchIdRef, lockedPairRef, nodesRef, selectedNodeRef,
        autoExpandMoreDoneRef, cacheEnabled, cacheBaseUrl,
        ENABLE_ACADEMIC_CORPORA, ENABLE_WEB_SEARCH, loadNodeImage, saveCacheNodeMeta,
        setNewlyExpandedNodeIds, setExpandingNodeId, setNewChildNodeIds,
        setSelectedNode, setSelectedLink, exploreTerm, isTextOnly, graphRef
    } = options;

    const fetchCacheExpansion = useCallback(async (sourceId: number | string) => {
        if (!cacheEnabled) return null;
        const url = new URL("/expansion", cacheBaseUrl);
        url.searchParams.set("sourceId", sourceId.toString());
        try {
            const res = await fetch(url.toString());
            if (!res.ok) return null;
            return res.json();
        } catch (e) {
            // console.warn("Cache fetch failed", e);
            return null;
        }
    }, [cacheEnabled, cacheBaseUrl]);

    const saveCacheExpansion = useCallback(async (sourceId: number | string, nodes: any[]) => {
        if (!cacheEnabled) return null;
        try {
            const res = await fetch(new URL("/expansion", cacheBaseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId, nodes })
            });
            if (res.ok) {
                const data = await res.json();
                return data.idMap as Record<string, number> | undefined;
            }
        } catch (e) {
            // console.warn("Cache save failed", e);
        }
        return null;
    }, [cacheEnabled, cacheBaseUrl]);

    const fetchAndExpandNode = useCallback(async (
        node: GraphNode,
        isInitial = false,
        forceMore = false,
        nodesOverride?: GraphNode[],
        linksOverride?: GraphLink[],
        skipSelection = false,
        skipExpandingHighlight = false
    ) => {
        const currentNodes = nodesOverride || graphDataRef.current.nodes;
        const currentLinks = linksOverride || graphDataRef.current.links;
        const guardId = searchIdRef.current;
        const isStale = () => searchIdRef.current !== guardId;

        if (!forceMore && (node.expanded || node.isLoading)) return;




        if (isStale()) return;
        setGraphData(prev => ({
            ...prev,
            nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: true } : n)
        }));

        const loadingGuard = setTimeout(() => {
            if (isStale()) return;
            setGraphData(prev => ({
                ...prev,
                nodes: prev.nodes.map(n => n.id === node.id ? { ...n, isLoading: true } : n)
            }));
        }, 0);

        setIsProcessing(true);
        setError(null);

        try {
            const nodeUpdates = new Map<string | number, Partial<GraphNode>>();
            const maybeAutoExpandMore = (neighborCount: number) => {
                if (forceMore) return;
                if (neighborCount > 3) return;
                if (autoExpandMoreDoneRef.current.has(String(node.id))) return;
                autoExpandMoreDoneRef.current.add(String(node.id));
                setTimeout(() => {
                    if (selectedNodeRef.current?.id !== node.id) return;

                    fetchAndExpandNode(node, false, true);
                }, 900);
            };

            if (cacheEnabled && !forceMore) {
                const cacheHit = await fetchCacheExpansion(node.id);
                if (cacheHit && cacheHit.hit === "exact" && cacheHit.nodes) {
                    let validCached: any[] = cacheHit.nodes.filter((cn: any) => String(cn.id) !== String(node.id));
                    // Concurrent upgrade of Wikipedia summaries if needed
                    const upgraded = await Promise.all(validCached.map(async (cn: any) => {
                        const meta = cn.meta || {};
                        if (!cn.wikiChecked && (String(meta.wikiSummary || cn.description || '').toLowerCase().includes(' is a song') || String(meta.wikiSummary || cn.description || '').toLowerCase().includes(' song written') || String(meta.wikiSummary || cn.description || '').toLowerCase().includes(' song by'))) {
                            setGraphData(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => String(n.id) === String(cn.id) ? { ...n, wikiChecked: true } : n)
                            }));
                            const wiki = await fetchWikipediaSummary(cn.title);
                            if (!wiki.extract && !wiki.pageid) return cn; // Return original if no new wiki data
                            setGraphData(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => String(n.id) === String(cn.id) ? {
                                    ...n,
                                    wikiSummary: wiki.extract || n.wikiSummary,
                                    wikipedia_id: wiki.pageid ? wiki.pageid.toString() : n.wikipedia_id
                                } : n)
                            }));
                            return {
                                ...cn,
                                wikipedia_id: wiki.pageid ? String(wiki.pageid) : cn.wikipedia_id,
                                description: wiki.extract,
                                meta: { ...meta, wikiSummary: wiki.extract },
                                wikiChecked: true
                            };
                        }
                        return cn;
                    }));
                    // The edge position (atomic_id vs composite_id) is the ground truth for
                    // bipartite membership. The is_atomic column in the DB can be stale/wrong.
                    // Infer the correct value from the parent: neighbors of a composite are atomic
                    // and vice versa.
                    const parentIsAtomic = !!(node.is_atomic ?? (node as any).is_person ?? (node.type || '').toLowerCase() === 'person');
                    const expectedChildIsAtomic = !parentIsAtomic;
                    validCached = upgraded.map((cn: any) => ({ ...cn, is_atomic: expectedChildIsAtomic }));

                    if (validCached.length >= 5) {
                        const existingNodeIdsBefore = new Set(graphDataRef.current.nodes.map(n => String(n.id)));
                        const newChildIds: (string | number)[] = validCached.filter(cn => !existingNodeIdsBefore.has(String(cn.id))).map(cn => cn.id);
                        // Include ALL connected nodes for highlighting, not just new ones
                        const allConnectedNodeIds = validCached.map(cn => cn.id);

                        if (isStale()) return;

                        setGraphData(prev => mergeExpansionGraph({
                            nodes: prev.nodes,
                            links: prev.links,
                            parent: node,
                            targets: validCached,
                            seedFromParent: true
                        }));

                        maybeAutoExpandMore(validCached.length);
                        if (!skipSelection) setSelectedNode(node);
                        if (!skipExpandingHighlight) {

                            setExpandingNodeId(node.id);
                            // Highlight ALL connected nodes, not just new ones
                            setNewChildNodeIds(new Set(allConnectedNodeIds.map(id => String(id))));
                        }

                        validCached.forEach((cn, idx) => {
                            if (!cn.imageUrl && !cn.imageChecked && !isTextOnly) {
                                setTimeout(() => loadNodeImage(cn.id, cn.title), 200 + 220 * idx);
                            }
                        });


                        setIsProcessing(false);
                        setGraphData(prev => ({
                            ...prev,
                            nodes: prev.nodes.map(n => n.id === node.id ? { ...n, expanded: true, isLoading: false } : n)
                        }));
                        return;
                    }
                }
            }


            const getLinkId = (thing: any) => {
                if (typeof thing === 'object' && thing !== null) return String(thing.id);
                return String(thing);
            };

            const neighborLinks = currentLinks.filter(l =>
                getLinkId(l.source) === String(node.id) ||
                getLinkId(l.target) === String(node.id)
            );

            const neighborNames = neighborLinks.map(l => {
                const sid = getLinkId(l.source);
                const tid = getLinkId(l.target);
                const neighborId = sid === String(node.id) ? tid : sid;
                return currentNodes.find(n => String(n.id) === String(neighborId))?.title || '';
            }).filter(Boolean);


            let wiki: any = {
                extract: node.wikiSummary || null,
                pageid: node.wikipedia_id ? Number(node.wikipedia_id) : null,
                mentioningPageTitles: node.mentioningPageTitles || null
            };
            if ((!wiki.extract && !wiki.pageid) || (wiki.extract && !wiki.pageid && !wiki.mentioningPageTitles)) {
                wiki = await fetchWikipediaSummary(node.title, neighborNames.join(' '));
            }

            if (wiki.extract) {
                const isPerson = node.is_atomic === true || node.is_person === true || node.type?.toLowerCase() === 'person';
                nodeUpdates.set(node.id, {
                    wikiSummary: wiki.extract,
                    wikipedia_id: wiki.pageid?.toString(),
                    mentioningPageTitles: wiki.mentioningPageTitles || undefined,
                    // Only use extracted year if node is an event (not a person) and currently missing a year
                    ...(!isPerson && !node.year && wiki.year ? { year: wiki.year } : {})
                });
            }


            let currentIsAtomic = node.is_atomic ?? (node as any).is_person;
            let currentType = node.type;
            const pair = lockedPairRef.current || { atomicType: "Person", compositeType: "Event" };
            const currentAtomicType = pair.atomicType;
            const currentCompositeType = pair.compositeType;
            const isAcademicPair = ENABLE_ACADEMIC_CORPORA && (pair.atomicType.toLowerCase() === 'author' || pair.compositeType.toLowerCase() === 'paper');

            if (!node.classification_reasoning) {
                nodeUpdates.set(node.id, {
                    classification_reasoning: `Locked pair: ${pair.atomicType} ↔ ${pair.compositeType}.`,
                    atomic_type: pair.atomicType,
                    composite_type: pair.compositeType
                });
            }


            if (currentIsAtomic === undefined) {

                const inferred = (node.type || '').toLowerCase() === pair.atomicType.toLowerCase() ? true
                    : (node.type || '').toLowerCase() === pair.compositeType.toLowerCase() ? false
                        : undefined;

                if (typeof inferred === 'boolean') {
                    currentIsAtomic = inferred;
                    nodeUpdates.set(node.id, { is_atomic: inferred });
                } else {
                    const classification = await classifyEntity(node.title);
                    currentIsAtomic = classification.isAtomic;
                    nodeUpdates.set(node.id, {
                        ...(typeof (node.is_atomic ?? (node as any).is_person) === 'boolean' ? {} : { is_atomic: classification.isAtomic }),
                        type: classification.type
                    });
                }
            }


            const extractResult = await fetchWikipediaExtract(node.title, 12000);
            const sourceLong = extractResult.extract || wiki.extract || '';

            const hasReliableWikipediaForThisTitle = !!(sourceLong && String(sourceLong).trim().length > 0);

            let verifiedContext = sourceLong;
            try {
                const expandingComposite = !(currentIsAtomic ?? currentType.toLowerCase() === 'person');

                if (!isAcademicPair && pair.atomicType.toLowerCase() === 'person' && expandingComposite) {

                    const wd = await fetchWikidataKeyPeopleForTitle(node.title);


                    if (wd) {
                        const lines: string[] = [];
                        if (wd.founders.length) lines.push(`Founders: ${wd.founders.join(', ')}`);
                        if (wd.directors.length) lines.push(`Directors/Managers: ${wd.directors.join(', ')}`);
                        if (wd.ceos.length) lines.push(`Chief Executive Officers: ${wd.ceos.join(', ')}`);
                        if (wd.keyPeople.length) lines.push(`Key People: ${wd.keyPeople.join(', ')}`);
                        if (lines.length) verifiedContext = `${verifiedContext}\n\nWIKIDATA (structured properties for "${node.title}", ${wd.wikidataId}):\n${lines.map(l => `- ${l}`).join('\n')}\n`;
                    } else if (ENABLE_WEB_SEARCH && (verifiedContext || '').trim().length < 400) {
                        const grounded = await fetchOrgKeyPeopleBlockViaSearch(node.title);
                        if (grounded) verifiedContext = `${verifiedContext}\n\n${grounded}\n`;
                    }
                }
            } catch (e) { }

            let results: any[] = [];
            const isPerson = currentIsAtomic ?? currentType.toLowerCase() === 'person';

            if (isAcademicPair) {
                const meta = (node as any).meta || {};
                const parentAuthorId = String(meta.openAlexAuthorId || '').trim();
                const parentWorkId = String(meta.openAlexWorkId || '').trim();
                if (isPerson) {
                    const author = parentAuthorId ? { id: parentAuthorId, display_name: node.title } : await searchOpenAlexAuthor(node.title);
                    if (author?.id) {
                        const works = await getTopWorksForAuthor(author.id, 10);
                        results = works.map(w => ({
                            ...openAlexWorkToPaperNode(w),
                            edge_label: 'Authored',
                            edge_meta: { evidence: makeOpenAlexAuthorshipEvidence(w, node.title) }
                        }));
                        if (!meta.openAlexAuthorId && author.id) nodeUpdates.set(node.id, { meta: { ...meta, openAlexAuthorId: author.id, openAlexUrl: author.id, source: 'openalex' } });
                    }
                } else {
                    // Check if this is "Work (Author)" pattern - if so, skip OpenAlex (it returns modern editions/translators)
                    // E.g., "Republic (Plato)" should use LLM, not OpenAlex database
                    const hasAuthorInParens = /^[^(]+\([A-Z][a-z]+(\s+[A-Z][a-z]+)*\)$/.test(node.title.trim());

                    const work = (!hasAuthorInParens && parentWorkId)
                        ? await getOpenAlexWork(parentWorkId)
                        : (!hasAuthorInParens ? await searchOpenAlexWork(node.title) : null);

                    if (work?.id) {
                        const authors = (work.authorships || []).map(a => a.author).filter(Boolean).map(a => ({ id: String(a!.id), display_name: String(a!.display_name) })).filter(a => a.id && a.display_name);
                        results = authors.slice(0, 12).map(a => ({
                            ...openAlexAuthorToAuthorNode({ id: a.id, display_name: a.display_name }),
                            edge_label: 'Author',
                            edge_meta: { evidence: makeOpenAlexAuthorshipEvidence(work, a.display_name) }
                        }));
                        if (!meta.openAlexWorkId && work.id) {
                            const paperNode = openAlexWorkToPaperNode(work);
                            nodeUpdates.set(node.id, {
                                meta: { ...meta, openAlexWorkId: work.id, doi: work.doi || undefined, openAlexUrl: work.id, source: 'openalex' },
                                ...((node.description || '').trim() ? {} : { description: paperNode.description, year: paperNode.year })
                            });
                        }
                    } else {
                        const doiMatch = (String(meta.doi || '') || String(node.title || '')).match(/\b10\.\d{4,9}\/\S+\b/i);
                        const doi = doiMatch ? doiMatch[0] : "";
                        if (doi) {
                            const cw = await fetchCrossrefWorkByDoi(doi);
                            if (cw) {
                                const authors = crossrefAuthors(cw);
                                results = authors.slice(0, 12).map(name => ({
                                    title: name, type: "Author", description: "", is_atomic: true, edge_label: "Author",
                                    edge_meta: { evidence: makeCrossrefAuthorshipEvidence(cw, name) }
                                }));
                                const paperNode = crossrefWorkToPaperNode(cw);
                                nodeUpdates.set(node.id, {
                                    meta: { ...meta, doi: cw.DOI || doi, crossrefUrl: paperNode.meta?.crossrefUrl, source: 'crossref' },
                                    ...((node.description || '').trim() ? {} : { description: paperNode.description, year: paperNode.year })
                                });
                            }
                        }
                    }
                }
            }

            // Fallback: If academic results were empty, proceed to standard expansion
            if (results.length === 0) {
                if (isPerson) {
                    let data = await fetchPersonWorks(node.title, neighborNames, verifiedContext || undefined, node.wikipedia_id, currentAtomicType, currentCompositeType, wiki.mentioningPageTitles || undefined);
                    if ((!data.works || data.works.length === 0) && neighborNames.length > 0) {
                        data = await fetchPersonWorks(node.title, [], verifiedContext || undefined, node.wikipedia_id, currentAtomicType, currentCompositeType, wiki.mentioningPageTitles || undefined);
                    }
                    results = (data.works || []).filter(w => typeof (w as any).entity === 'string' && (w as any).entity.trim().length > 0).map(w => ({
                        title: (w as any).wikipediaTitle || w.entity,
                        type: (w as any).type || currentCompositeType,
                        description: w.description,
                        year: w.year ?? undefined,
                        role: w.role ?? undefined,
                        is_atomic: (w as any).isAtomic !== undefined ? (w as any).isAtomic : false,
                        edge_meta: {
                            evidence: {
                                kind: 'ai', pageTitle: (w as any).evidencePageTitle || node.title, snippet: (w as any).evidenceSnippet || '',
                                url: looksLikeWikipediaTitle((w as any).evidencePageTitle || node.title) ? (
                                    ((String((w as any).evidencePageTitle || node.title) === node.title) && !hasReliableWikipediaForThisTitle)
                                        ? undefined
                                        : buildWikiUrl((w as any).evidencePageTitle || node.title, (String((w as any).evidencePageTitle || node.title) === node.title) ? node.wikipedia_id : undefined)
                                ) : undefined
                            }
                        },
                        edge_label: w.role || null
                    }));
                } else {
                    let data = await fetchConnections(node.title, undefined, neighborNames, verifiedContext || undefined, node.wikipedia_id, currentAtomicType, currentCompositeType, wiki.mentioningPageTitles || undefined);
                    if ((!data.people || data.people.length === 0) && neighborNames.length > 0) {
                        data = await fetchConnections(node.title, undefined, [], verifiedContext || undefined, node.wikipedia_id, currentAtomicType, currentCompositeType, wiki.mentioningPageTitles || undefined);
                    }
                    if (data.sourceYear) nodeUpdates.set(node.id, { year: data.sourceYear });
                    const atomicTypeToUse = currentAtomicType || 'Person';
                    results = (data.people || []).map(p => ({
                        title: (p as any).wikipediaTitle || p.name,
                        type: atomicTypeToUse,
                        description: p.description,
                        role: p.role,
                        is_atomic: (p as any).isAtomic !== undefined ? (p as any).isAtomic : true,
                        edge_meta: {
                            evidence: {
                                kind: 'ai', pageTitle: (p as any).evidencePageTitle || node.title, snippet: (p as any).evidenceSnippet || '',
                                url: looksLikeWikipediaTitle((p as any).evidencePageTitle || node.title) ? (
                                    ((String((p as any).evidencePageTitle || node.title) === node.title) && !hasReliableWikipediaForThisTitle)
                                        ? undefined
                                        : buildWikiUrl((p as any).evidencePageTitle || node.title, (String((p as any).evidencePageTitle || node.title) === node.title) ? node.wikipedia_id : undefined)
                                ) : undefined
                            }
                        },
                        edge_label: p.role || null
                    }));
                }



                if (results.length === 0 && sourceLong) {
                    const sentences = splitIntoSentences(sourceLong);
                    const patterns = [
                        { role: 'Author', re: /\bis (?:an?|the)\s+(?:nonfiction\s+)?(?:book|novel|memoir|biography|essay)\s+by\s+([^.;]+)/i },
                        { role: 'Author', re: /\bwritten by\s+([^.;]+)/i },
                        { role: 'Director', re: /\b(?:film|movie)\s+directed by\s+([^.;]+)/i },
                        { role: 'Creator', re: /\bcreated by\s+([^.;]+)/i },
                    ];
                    for (const sent of sentences.slice(0, 4)) {
                        for (const ptn of patterns) {
                            const m = sent.match(ptn.re);
                            if (m) {
                                const name = String(m[1] || '').split(/,| and | who | which /i)[0].trim();
                                if (name && name.split(/\s+/).length >= 2) {
                                    const atomicTypeToUse = currentAtomicType || 'Person';
                                    results = [{ title: name, type: atomicTypeToUse, description: `${ptn.role} associated with ${node.title}.`, role: ptn.role, is_atomic: true, edge_meta: { evidence: { kind: 'wikipedia', pageTitle: node.title, snippet: sent, url: looksLikeWikipediaTitle(node.title) ? buildWikiUrl(node.title) : undefined } }, edge_label: ptn.role }];
                                    break;
                                }
                            }
                        }
                        if (results.length) break;
                    }
                }

                if (looksLikeScreenWork(node.title, node.description || sourceLong)) {
                    try {
                        const castLabels = await fetchWikidataCastForTitle(node.title);
                        if (castLabels.length) {
                            const existingNames = new Set(results.map(r => normalizeForDedup(r.title)));
                            const atomicTypeToUse = currentAtomicType || 'Person';
                            castLabels.forEach(name => {
                                const key = normalizeForDedup(name);
                                if (!key || existingNames.has(key)) return;
                                existingNames.add(key);
                                results.push({ title: name, type: atomicTypeToUse, description: `Cast member in ${node.title}.`, role: 'Cast', is_atomic: true, edge_meta: { evidence: { kind: 'wikipedia', pageTitle: node.title, snippet: `${name} is a cast member in ${node.title}.`, url: looksLikeWikipediaTitle(node.title) ? buildWikiUrl(node.title) : undefined } }, edge_label: 'Cast' });
                            });
                        }
                    } catch (e) { }
                }
            }

            if (!skipSelection) setSelectedNode(node);
            if (!skipExpandingHighlight) setExpandingNodeId(node.id);

            if (results.length === 0) {
                if (isInitial) {
                    setError(`No connections found for "${node.title}".`);
                    setGraphData({ nodes: [], links: [] });
                    setSelectedNode(null);
                    setSelectedLink(null);
                    setExpandingNodeId(null);
                    setNewChildNodeIds(new Set());
                } else {
                    setGraphData(prev => ({ ...prev, nodes: prev.nodes.map(n => String(n.id) === String(node.id) ? { ...n, expanded: true, isLoading: false } : n) }));
                    setExpandingNodeId(null);
                    setNewChildNodeIds(new Set());
                }
            } else {
                const resultsWithWiki = await Promise.all(results.map(async r => {
                    const contextHint = [node.title, r.type, r.edge_label || r.role, r.description, r.edge_meta?.evidence?.snippet].filter(Boolean).join(' · ').slice(0, 280);
                    const skipWiki = isAcademicPair || String(r.edge_meta?.evidence?.kind || '') === 'openalex';
                    const rWiki = skipWiki ? ({ title: r.title, extract: '', pageid: undefined } as any) : await fetchWikipediaSummary(r.title, contextHint);
                    let evidence: any = r.edge_meta?.evidence || { kind: 'none' as const };
                    const pageTitle = String(evidence?.pageTitle || '');
                    const snippet = String(evidence?.snippet || '');
                    const pageLooksNonWiki = pageTitle.includes(' - ') || /^https?:\/\//i.test(pageTitle) || !looksLikeWikipediaTitle(pageTitle);

                    if (evidence && evidence.kind === 'ai' && snippet && pageTitle && !pageLooksNonWiki) {
                    } else if (pageLooksNonWiki) {
                        evidence = { kind: 'none' as const };
                    }

                    return {
                        ...r, title: rWiki.title || r.title, wikipedia_id: rWiki.pageid?.toString(),
                        description: rWiki.extract || r.description,
                        meta: { ...(r.meta || {}), wikiSummary: rWiki.extract || undefined },
                        edge_meta: { evidence },
                        edge_label: (() => {
                            const lbl = r.edge_label || r.role || null;
                            if ((!evidence || evidence.kind === 'none') && roleLooksLikeJobTitle(lbl)) return null;
                            return lbl;
                        })(),
                        ...(typeof (rWiki.title || r.title) === 'string' && isParenJobTitle(rWiki.title || r.title) && (!evidence || evidence.kind === 'none')
                            ? { title: sanitizeTitleParen(rWiki.title || r.title) } : {})
                    };
                }));

                let nodesToUse = resultsWithWiki;
                if (!exploreTerm.toLowerCase().startsWith('list of ')) nodesToUse = nodesToUse.filter((n: any) => !isBadListPage(n.title));

                let finalIDMap: Record<string, number> | undefined;
                if (cacheEnabled) {
                    let combinedNodes = [...resultsWithWiki];
                    const existingCache = await fetchCacheExpansion(node.id);
                    if (existingCache && existingCache.nodes) {
                        const byTitle = new Map<string, any>();
                        existingCache.nodes.forEach((n: any) => { if (n?.title) byTitle.set(String(n.title).toLowerCase(), n); });
                        resultsWithWiki.forEach((n: any) => {
                            const key = String(n.title || '').toLowerCase();
                            if (!key) return;
                            const existing = byTitle.get(key);
                            if (!existing) { byTitle.set(key, n); return; }
                            byTitle.set(key, { ...existing, ...n, id: existing.id ?? n.id, wikipedia_id: n.wikipedia_id || existing.wikipedia_id, description: (n.description && n.description.length >= (existing.description || '').length) ? n.description : existing.description, meta: { ...(existing.meta || {}), ...(n.meta || {}) }, edge_meta: n.edge_meta || existing.edge_meta, edge_label: n.edge_label || existing.edge_label });
                        });
                        combinedNodes = Array.from(byTitle.values());
                    }
                    finalIDMap = (await saveCacheExpansion(node.id, combinedNodes)) ?? undefined;
                    const cacheHit = await fetchCacheExpansion(node.id);
                    if (cacheHit && cacheHit.nodes) nodesToUse = cacheHit.nodes;
                }

                const currentNodesForDedupe = graphDataRef.current.nodes;
                const existingByNorm = new Map<string, GraphNode>(currentNodesForDedupe.map(n => [baseDedupeKey(n as any), n]));
                const verifiedNorm = normalizeForEvidence(sourceLong);
                nodesToUse = nodesToUse.map(cn => sanitizeEvidenceAndRole(cn, verifiedNorm));
                // Only filter person nodes for specific names; allow all other types through
                nodesToUse = nodesToUse.filter((cn: any) => {
                    const nodeType = String(cn?.type || '').toLowerCase();
                    if (nodeType === 'person' || nodeType === 'actor' || nodeType === 'author') {
                        return looksLikeSpecificPersonName(cn?.title);
                    }
                    return true; // Allow all non-person nodes
                });


                const processedNodes = nodesToUse.map(cn => {
                    const norm = baseDedupeKey(cn as any);
                    const existing = existingByNorm.get(norm);
                    let idToUse = existing ? existing.id : (cn.id ?? Math.floor(Math.random() * 1000000));

                    // SYNC WITH DATABASE ID IF AVAILABLE
                    if (finalIDMap) {
                        const wikiId = (cn.wikipedia_id || cn.wikipediaId || "").toString().trim();
                        const key = `${cn.title}|${cn.type}|${wikiId || ''}`;
                        if (finalIDMap[key]) {
                            idToUse = finalIDMap[key];
                        }
                    }

                    if (!existing) existingByNorm.set(norm, { id: idToUse, title: cn.title, type: cn.type } as GraphNode);
                    return { ...cn, id: idToUse };
                });

                const currentNodesForNewIds = graphDataRef.current.nodes;
                const existingNodeIdsBefore = new Set(currentNodesForNewIds.map(n => String(n.id)));
                const newChildIds = processedNodes.filter(cn => !existingNodeIdsBefore.has(String(cn.id))).map(cn => cn.id);

                // Include ALL connected nodes for highlighting, not just new ones
                const allConnectedNodeIds = processedNodes.map(cn => cn.id);



                if (isStale()) return;
                setGraphData(prev => {
                    const nodeMap = new Map<string, GraphNode>(prev.nodes.map(n => [String(n.id), n]));
                    const expectedChildIsAtomic = !currentIsAtomic;
                    processedNodes.forEach(cn => {
                        const meta = cn.meta || {};
                        const existing = nodeMap.get(String(cn.id));
                        nodeMap.set(String(cn.id), {
                            id: cn.id, title: cn.title, type: cn.type,
                            is_atomic: (existing?.is_atomic ?? (existing as any)?.is_person ?? (typeof (cn as any).is_atomic === 'boolean' ? (cn as any).is_atomic : expectedChildIsAtomic)),
                            wikipedia_id: cn.wikipedia_id, description: cn.description || existing?.description || "",
                            year: cn.year ?? existing?.year, imageUrl: meta.imageUrl ?? existing?.imageUrl,
                            imageChecked: !!(meta.imageUrl ?? existing?.imageUrl) || existing?.imageChecked,
                            wikiSummary: meta.wikiSummary ?? (existing as any)?.wikiSummary,
                            x: existing?.x ?? (node.x ? node.x + (Math.random() - 0.5) * 100 : undefined),
                            y: existing?.y ?? (node.y ? node.y + (Math.random() - 0.5) * 100 : undefined),
                            expanded: existing?.expanded || false, isLoading: false
                        });
                    });
                    if (nodeMap.has(String(node.id))) nodeMap.set(String(node.id), { ...nodeMap.get(String(node.id))!, expanded: true, isLoading: true, ...nodeUpdates.get(node.id) });

                    const getLinkId = (thing: any) => String(typeof thing === 'object' ? thing?.id : thing);
                    const linkMap = new Map<string, GraphLink>(prev.links.map(l => [`${getLinkId(l.source)}↔${getLinkId(l.target)}`, l]));
                    const candidateLinks: GraphLink[] = processedNodes.map(cn => {
                        // Find the original result to get the raw evidence before any wiki/dedupe processing
                        const sanitizedResults = nodesToUse; // nodesToUse already contains the sanitized results
                        const rawEvidence = (sanitizedResults.find(r => baseDedupeKey(r) === baseDedupeKey(cn))?.edge_meta?.evidence) || { kind: 'none' as const };
                        const sourceNodeId = node.id;
                        const targetNodeId = cn.id;
                        const sid = getLinkId(sourceNodeId);
                        const tid = getLinkId(targetNodeId);
                        const lid1 = `${sid}↔${tid}`;
                        const lid2 = `${tid}↔${sid}`;
                        const existingl = linkMap.get(lid1) || linkMap.get(lid2);
                        return {
                            id: existingl?.id ?? Math.floor(Math.random() * 1000000), source: sourceNodeId, target: targetNodeId,
                            label: cn.edge_label || existingl?.label || "",
                            evidence: rawEvidence
                        };
                    });
                    const bipartiteSafeCandidates = candidateLinks.filter(l => {
                        const sid = getLinkId(l.source);
                        const tid = getLinkId(l.target);

                        // RELAXATION: If this is a direct link from the node we are currently expanding,
                        // we trust the AI and permit it regardless of bipartite classification
                        // to avoid "empty expansions" when classification is fuzzy.
                        if (sid === String(node.id)) return true;

                        const sourceNode = nodeMap.get(sid);
                        const targetNode = nodeMap.get(tid);
                        if (!sourceNode || !targetNode) return false; // Should not happen if nodes are in nodeMap
                        const sAtomic = sourceNode.is_atomic ?? false;
                        const tAtomic = targetNode.is_atomic ?? false;
                        if (sAtomic === tAtomic) { return false; }
                        return true;
                    });

                    const updatedExistingLinks = prev.links.map(l => {
                        const cand = bipartiteSafeCandidates.find(c => c.id === l.id);
                        return cand ? { ...l, label: l.label || cand.label, evidence: (!l.evidence || l.evidence.kind === 'none') ? cand.evidence : l.evidence } : l;
                    });
                    const combinedLinks = [...updatedExistingLinks, ...bipartiteSafeCandidates.filter(l => !prev.links.some(ex => ex.id === l.id))];
                    const degree = new Map<string, number>();
                    combinedLinks.forEach(l => {
                        const s = getLinkId(l.source);
                        const t = getLinkId(l.target);
                        degree.set(s, (degree.get(s) || 0) + 1);
                        degree.set(t, (degree.get(t) || 0) + 1);
                    });
                    const finalNodes = Array.from(nodeMap.values()).filter(n => {
                        const isExpandingRoot = String(n.id) === String(node.id);
                        const hasDegree = (degree.get(String(n.id)) || 0) > 0;
                        if (n.isLoading) return true;
                        return isExpandingRoot || hasDegree;
                    });

                    return dedupeGraph(finalNodes, combinedLinks);
                });

                maybeAutoExpandMore(processedNodes.length);

                // Highlight ALL connected nodes, not just new ones
                if (!skipExpandingHighlight) setNewChildNodeIds(new Set(allConnectedNodeIds.map(id => String(id))));
                processedNodes.forEach((cn, idx) => {
                    if (!cn.imageUrl && !cn.imageChecked && !isTextOnly) {
                        setTimeout(() => loadNodeImage(cn.id, cn.title), 350 + 380 * idx);
                    }
                });

                setTimeout(() => {
                    if (isStale()) return;
                    setGraphData(prev => ({ ...prev, nodes: prev.nodes.map(n => String(n.id) === String(node.id) ? { ...n, expanded: true, isLoading: false, ...nodeUpdates.get(node.id) } : n) }));
                    const updates = nodeUpdates.get(node.id);
                    if (updates) saveCacheNodeMeta(node.id, updates, node);
                    setTimeout(() => {
                        graphRef.current?.fitGraphInView();
                        if (!skipExpandingHighlight) {
                            setExpandingNodeId(null);
                            // Keep newChildNodeIds so they remain highlighted
                        }
                    }, 200);
                }, 500);
            }
        } catch (error) {
            console.error("Failed to expand node", error);
            if (!isStale()) {
                setError(`Failed to fetch connections: ${(error as any)?.message || 'unknown error'}`);
                setGraphData(prev => ({ ...prev, nodes: prev.nodes.map(n => String(n.id) === String(node.id) ? { ...n, isLoading: false } : n) }));
            }
            setSelectedNode(null); setSelectedLink(null); setExpandingNodeId(null); setNewChildNodeIds(new Set());
        } finally {
            clearTimeout(loadingGuard);
            if (!isStale()) setIsProcessing(false);
        }
    }, [loadNodeImage, cacheEnabled, fetchCacheExpansion, saveCacheExpansion, cacheBaseUrl, saveCacheNodeMeta, setGraphData, setIsProcessing, setError, searchIdRef, lockedPairRef, nodesRef, selectedNodeRef, autoExpandMoreDoneRef, ENABLE_ACADEMIC_CORPORA, ENABLE_WEB_SEARCH, setNewlyExpandedNodeIds, setExpandingNodeId, setNewChildNodeIds, setSelectedNode, setSelectedLink, exploreTerm, isTextOnly, graphRef]);

    return { fetchAndExpandNode, fetchCacheExpansion, saveCacheExpansion };
}
