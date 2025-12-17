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
    } catch (e) {}
    if (key) return key;
    try {
        if (typeof process !== 'undefined' && process.env) {
            key = process.env.VITE_API_KEY || process.env.NEXT_PUBLIC_API_KEY || process.env.REACT_APP_API_KEY || process.env.API_KEY || "";
        }
    } catch (e) {}
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
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [error, setError] = useState<string | null>(null);
  const [isKeyReady, setIsKeyReady] = useState(false);

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
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: true } : n));
    const url = await fetchWikipediaImage(nodeId);
    if (url) {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: url, fetchingImage: false, imageChecked: true } : n));
    } else {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: false, imageChecked: true } : n));
    }
  }, []);

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

  const handleStartSearch = async (term: string) => {
    setIsProcessing(true);
    setError(null);
    
    let type = 'Event';
    try {
        // Determine if it's a Person or a Thing (Event/Movie/etc)
        type = await classifyEntity(term);
    } catch (e) {
        console.error("Classification error", e);
    }
    
    // We trim, but we don't normalize aggressively here to preserve user casing preference
    // unless strictly needed.
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
  };

  const handlePathSearch = async (start: string, end: string) => {
      setIsProcessing(true);
      setError(null);

      // If graph is empty, clear it just in case, or we can append.
      // Let's clear for a clean path view, or append if user wants... 
      // For a "Path" tool, usually clean slate is better unless we want to connect existing.
      // But typically "Six Degrees" is a standalone query. Let's keep existing if we can, 
      // but maybe focus on the path. 
      // Decision: Append to existing graph if nodes exist, to allow building a mega-graph.
      
      try {
          const pathData = await fetchConnectionPath(start, end);
          if (pathData.path.length < 2) {
              setError("Could not find a valid path between these entities.");
              setIsProcessing(false);
              return;
          }

          let newNodes: GraphNode[] = [];
          let newLinks: GraphLink[] = [];
          const nodeUpdates = new Map<string, Partial<GraphNode>>();
          
          let previousNodeId: string | null = null;
          let previousJustification: string | null = null;

          // Process the path chain
          for (let i = 0; i < pathData.path.length; i++) {
              const entity = pathData.path[i];
              // Resolve ID against current state AND the newNodes we are building in this loop
              const resolvedId = resolveNodeId(entity.id, nodes, newNodes);

              const existingNode = nodes.find(n => n.id === resolvedId);
              const pendingNode = newNodes.find(n => n.id === resolvedId);

              // Add Node if missing
              if (!existingNode && !pendingNode) {
                   const newNode: GraphNode = {
                       id: resolvedId,
                       type: entity.type,
                       description: entity.description,
                       year: entity.year,
                       // Lay them out in a line roughly
                       x: (dimensions.width / 2) + ((i - pathData.path.length/2) * 150),
                       y: dimensions.height / 2 + (Math.random() * 50),
                       expanded: true // Assume part of path is "explored"
                   };
                   newNodes.push(newNode);
              } else {
                  // Merge data
                  if (existingNode && !existingNode.year && entity.year) {
                      nodeUpdates.set(existingNode.id, { year: entity.year });
                  }
              }

              // Link to previous
              if (previousNodeId) {
                   const linkId = `${previousNodeId}-${resolvedId}`;
                   const reverseLinkId = `${resolvedId}-${previousNodeId}`;
                   
                   // Check link existence (including in newLinks)
                   const linkExists = links.some(l => l.id === linkId || l.id === reverseLinkId) ||
                                      newLinks.some(l => l.id === linkId || l.id === reverseLinkId);
                   
                   if (!linkExists) {
                       newLinks.push({
                           source: previousNodeId,
                           target: resolvedId,
                           id: linkId,
                           label: entity.justification || "Connected"
                       });
                   }
              }

              previousNodeId = resolvedId;
          }

          // Apply updates (Reuse similar logic to expandNode)
          setNodes(prev => {
                const existingMap = new Map<string, GraphNode>(prev.map(n => [n.id, n] as [string, GraphNode]));
                
                // Add explicit updates
                nodeUpdates.forEach((updates, id) => {
                    if (existingMap.has(id)) {
                        existingMap.set(id, { ...existingMap.get(id)!, ...updates });
                    }
                });

                // Add new nodes (handling collision if resolveNodeId missed something subtle, though unlikely)
                const trulyNew = newNodes.filter(n => !existingMap.has(n.id));
                return [...Array.from(existingMap.values()), ...trulyNew];
          });

          setLinks(prev => [...prev, ...newLinks]);

          // Trigger image loads
          newNodes.forEach((n, index) => {
              setTimeout(() => {
                  loadNodeImage(n.id);
              }, 300 * index);
          });
          
          if (newNodes.length > 0) {
              setSelectedNode(newNodes[0]);
          }

      } catch (err) {
          console.error("Path search failed", err);
          setError("Failed to generate a path. Try different entities.");
      } finally {
          setIsProcessing(false);
      }
  };

  const handlePrune = () => {
      // Remove leaf nodes (nodes with only 1 link) that are not the selected node
      const linkCounts = new Map<string, number>();
      links.forEach(l => {
          const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
          const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
          linkCounts.set(s, (linkCounts.get(s) || 0) + 1);
          linkCounts.set(t, (linkCounts.get(t) || 0) + 1);
      });

      const nodesToKeep = nodes.filter(n => {
          // Keep selected node
          if (selectedNode && n.id === selectedNode.id) return true;
          // Keep nodes with more than 1 connection
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

  const expandNode = useCallback(async (node: GraphNode, isInitial = false) => {
    if (node.expanded || node.isLoading) return;

    // Mark loading immediately
    setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: true } : n));
    setIsProcessing(true);
    setError(null);

    try {
      let newNodes: GraphNode[] = [];
      let newLinks: GraphLink[] = [];
      const nodeUpdates = new Map<string, Partial<GraphNode>>();

      // BRANCH LOGIC: PERSON vs THING
      if (node.type === 'Person') {
          // 1. EXPAND PERSON -> TIMELINE WORKS
          
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
             // RESOLVE ID STRICTLY
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
                 // Update year on existing node if missing
                 if (existingNode && !existingNode.year && work.year) {
                     nodeUpdates.set(existingNode.id, { year: work.year });
                 }
                 if (pendingNode && !pendingNode.year && work.year) {
                     pendingNode.year = work.year;
                 }
             }

             // Create Link (Label = Year)
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
          // 2. EXPAND THING -> PEOPLE
          const data = await fetchConnections(node.id);
          
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
                 // Just mark expanded
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

      // Apply updates
      setNodes(prev => {
         const existingMap = new Map<string, GraphNode>(prev.map(n => [n.id, n] as [string, GraphNode]));
         
         // 1. Identify which 'newNodes' are actually collisions (race condition handling)
         const collisions = newNodes.filter(n => existingMap.has(n.id));
         const trulyNew = newNodes.filter(n => !existingMap.has(n.id));
         
         // 2. Update existingMap with explicit updates
         nodeUpdates.forEach((updates, id) => {
             if (existingMap.has(id)) {
                 existingMap.set(id, { ...existingMap.get(id)!, ...updates });
             }
         });
         
         // 3. Update existingMap with data from collisions
         collisions.forEach(col => {
             const ex = existingMap.get(col.id)!;
             const updated = { ...ex };
             let changed = false;
             if (!updated.year && col.year) { updated.year = col.year; changed = true; }
             if (!updated.description && col.description) { updated.description = col.description; changed = true; }
             if (changed) existingMap.set(col.id, updated);
         });
         
         // 4. Update the source node
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

      // Stagger image loads for truly new nodes
      newNodes.forEach((n, index) => {
          // Optimistic check: only load if we think it's new. 
          // Real check happens in loadNodeImage anyway.
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

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
    if (!node.expanded) {
        expandNode(node);
    }
  };

  const handleViewportChange = useCallback((visibleNodes: GraphNode[]) => {
    if (visibleNodes.length <= 15) {
        visibleNodes.forEach((node, index) => {
            if (!node.imageUrl && !node.fetchingImage && !node.imageChecked) {
                 setTimeout(() => {
                    loadNodeImage(node.id);
                 }, 200 * index);
            }
        });
    }
  }, [loadNodeImage]);

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
      />
      
      <ControlPanel 
        onSearch={handleStartSearch} 
        onPathSearch={handlePathSearch}
        isProcessing={isProcessing} 
        isCompact={isCompact}
        onToggleCompact={() => setIsCompact(!isCompact)}
        isTimelineMode={isTimelineMode}
        onToggleTimeline={() => setIsTimelineMode(!isTimelineMode)}
        onPrune={handlePrune}
        error={error}
      />
      <Sidebar 
        selectedNode={selectedNode} 
        onClose={() => setSelectedNode(null)} 
      />
    </div>
  );
};

export default App;