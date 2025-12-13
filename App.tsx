import React, { useState, useEffect, useCallback } from 'react';
import Graph from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import { GraphNode, GraphLink } from './types';
import { fetchConnections, fetchPersonWorks } from './services/geminiService';
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
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: url, fetchingImage: false } : { ...n, fetchingImage: false }));
    } else {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: false } : n));
    }
  }, []);

  const handleStartSearch = async (term: string) => {
    setError(null);
    const startNode: GraphNode = {
      id: term,
      type: 'Origin',
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
          // Keep Origin
          if (n.type === 'Origin') return true;
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
             // Check if node exists or is pending
             const existingNode = nodes.find(n => n.id === work.entity);
             const pendingNode = newNodes.find(n => n.id === work.entity);

             if (!existingNode && !pendingNode) {
                 const newNode: GraphNode = {
                     id: work.entity,
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
             const linkId = `${node.id}-${work.entity}`;
             if (!links.some(l => l.id === linkId) && !newLinks.some(l => l.id === linkId)) {
                 newLinks.push({
                     source: node.id,
                     target: work.entity,
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
                  const existingNode = nodes.find(n => n.id === person.name);
                  const pendingNode = newNodes.find(n => n.id === person.name);

                  if (!existingNode && !pendingNode) {
                      newNodes.push({
                          id: person.name,
                          type: 'Person',
                          description: person.description,
                          x: (node.x || 0) + (Math.random() - 0.5) * 150,
                          y: (node.y || 0) + (Math.random() - 0.5) * 150,
                          expanded: false 
                      });
                  }

                  const linkId = `${node.id}-${person.name}`;
                  if (!links.some(l => l.id === linkId) && !newLinks.some(l => l.id === linkId)) {
                      newLinks.push({
                          source: node.id,
                          target: person.name,
                          id: linkId,
                          label: person.role
                      });
                  }
              });
          }
      }

      // Apply updates in a single batch
      setNodes(prev => {
         const nextNodes = prev.map(n => {
             // Apply specific updates
             if (nodeUpdates.has(n.id)) {
                 // Merge existing updates
                 return { ...n, ...nodeUpdates.get(n.id) };
             }
             // Always ensure source node is marked done
             if (n.id === node.id) {
                 return { ...n, isLoading: false, expanded: true, ...nodeUpdates.get(n.id) };
             }
             return n;
         });
         return [...nextNodes, ...newNodes];
      });

      setLinks(prev => [...prev, ...newLinks]);

      // Stagger image loads for new nodes
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
  }, [nodes, links, loadNodeImage]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
    if (!node.expanded) {
        expandNode(node);
    }
  };

  const handleViewportChange = useCallback((visibleNodes: GraphNode[]) => {
    if (visibleNodes.length <= 15) {
        visibleNodes.forEach((node, index) => {
            if (!node.imageUrl && !node.fetchingImage) {
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