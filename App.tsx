import React, { useState, useEffect, useCallback } from 'react';
import Graph from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import { GraphNode, GraphLink } from './types';
import { fetchConnections, fetchPersonWorks } from './services/geminiService';
import { fetchWikipediaImage } from './services/wikipediaService';
import { Key } from 'lucide-react';

const App: React.FC = () => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [error, setError] = useState<string | null>(null);
  const [isKeyReady, setIsKeyReady] = useState(false);

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      console.log("DEBUG: Checking API Key configuration...");
      console.log("DEBUG: process.env.API_KEY value:", process.env.API_KEY);

      // If running in an environment with the aistudio helper (Project IDX/AI Studio)
      if ((window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        console.log("DEBUG: window.aistudio.hasSelectedApiKey() returned:", hasKey);
        setIsKeyReady(hasKey);
      } else {
        // Fallback: If process.env.API_KEY appears to be set (e.g. local dev), proceed.
        // We use a safe check in case process is undefined.
        try {
            if (process.env.API_KEY) {
                console.log("DEBUG: API Key found in process.env");
                setIsKeyReady(true);
            } else {
                console.warn("DEBUG: API Key NOT found in process.env");
            }
        } catch (e) {
            // process not defined
        }
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
      if ((window as any).aistudio) {
          await (window as any).aistudio.openSelectKey();
          // Assume success per instructions regarding race conditions
          setIsKeyReady(true);
      }
  };

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Helper to fetch and update image for a node
  const loadNodeImage = useCallback(async (nodeId: string) => {
    // Optimistic update to prevent double fetching
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: true } : n));
    
    const url = await fetchWikipediaImage(nodeId);
    if (url) {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, imageUrl: url, fetchingImage: false } : { ...n, fetchingImage: false }));
    } else {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, fetchingImage: false } : n));
    }
  }, []);

  // Helper to fetch and update image for a link (person)
  const loadLinkImage = useCallback(async (linkId: string, personName: string) => {
    setLinks(prev => prev.map(l => l.id === linkId ? { ...l, fetchingImage: true } : l));
    
    const url = await fetchWikipediaImage(personName);
    if (url) {
      setLinks(prev => prev.map(l => l.id === linkId ? { ...l, imageUrl: url, fetchingImage: false } : { ...l, fetchingImage: false }));
    } else {
      setLinks(prev => prev.map(l => l.id === linkId ? { ...l, fetchingImage: false } : l));
    }
  }, []);

  const handleStartSearch = async (term: string) => {
    setError(null);
    // Reset graph
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
    
    // Load image for start node immediately
    loadNodeImage(startNode.id);
    
    // Automatically trigger expansion for the start node
    await expandNode(startNode, true);
  };

  const expandNode = useCallback(async (node: GraphNode, isInitial = false) => {
    if (node.expanded || node.isLoading) return;

    // Update node state to loading
    setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: true } : n));
    setIsProcessing(true);
    setError(null);

    try {
      const data = await fetchConnections(node.id);
      
      if (data.connections.length === 0) {
        if (isInitial) {
             setError(`No connections found for "${node.id}". Try a different topic.`);
             // Remove the solitary node if it was a fresh search that failed
             setNodes([]);
             setSelectedNode(null);
        } else {
             // Just stop loading if it's an expansion of an existing node
             setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: false, expanded: true } : n)); 
             // We mark expanded=true so we don't retry immediately
        }
        setIsProcessing(false);
        return;
      }

      const newNodes: GraphNode[] = [];
      const newLinks: GraphLink[] = [];

      data.connections.forEach((conn) => {
        // Check if node already exists
        const existingNode = nodes.find(n => n.id === conn.connectedEntity) || newNodes.find(n => n.id === conn.connectedEntity);
        
        let targetNodeId = conn.connectedEntity;

        if (!existingNode) {
            // Create new node
            const newNode: GraphNode = {
                id: conn.connectedEntity,
                type: conn.connectedEntityType,
                description: conn.entityDescription,
                // Initial position near the source node to prevent wild jumping
                x: (node.x || 0) + (Math.random() - 0.5) * 100,
                y: (node.y || 0) + (Math.random() - 0.5) * 100,
            };
            newNodes.push(newNode);
        }

        // Check if link already exists (avoid duplicate edges for same person between same nodes)
        const linkExists = links.some(l => 
            (l.source === node.id && l.target === targetNodeId && l.person === conn.personName) ||
            (l.source === targetNodeId && l.target === node.id && l.person === conn.personName)
        ) || newLinks.some(l =>
             (l.source === node.id && l.target === targetNodeId && l.person === conn.personName)
        );

        if (!linkExists) {
            newLinks.push({
                source: node.id,
                target: targetNodeId,
                person: conn.personName,
                role: conn.personRole,
                id: `${node.id}-${targetNodeId}-${conn.personName}`
            });
        }
      });

      // Update state with new nodes and set expanded=true for current node
      setNodes(prev => {
         const updated = prev.map(n => n.id === node.id ? { ...n, isLoading: false, expanded: true } : n);
         return [...updated, ...newNodes];
      });
      setLinks(prev => [...prev, ...newLinks]);

      // Trigger image fetches for new links
      newLinks.forEach(link => {
        loadLinkImage(link.id, link.person);
      });

    } catch (error) {
      console.error("Failed to expand node", error);
      setError("Failed to fetch connections. The AI might be busy or the topic is restricted.");
      setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: false } : n));
    } finally {
      setIsProcessing(false);
    }
  }, [nodes, links, loadLinkImage]);

  const handleLinkClick = useCallback(async (link: GraphLink) => {
    if (link.isExpanding) return;

    // Set expanding state
    setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isExpanding: true } : l));
    setError(null);

    try {
        const data = await fetchPersonWorks(link.person);
        
        // We will attach new nodes to the "source" of the clicked link as an anchor
        // Ensure source is a GraphNode object
        const anchorNode = typeof link.source === 'object' ? link.source as GraphNode : nodes.find(n => n.id === link.source);
        
        if (!anchorNode) {
            setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isExpanding: false } : l));
            return;
        }

        const newNodes: GraphNode[] = [];
        const newLinks: GraphLink[] = [];

        data.works.forEach(work => {
             // Check if node exists
             const exists = nodes.find(n => n.id === work.entity) || newNodes.find(n => n.id === work.entity);
             
             if (!exists) {
                 newNodes.push({
                     id: work.entity,
                     type: work.type,
                     description: work.description,
                     x: (anchorNode.x || 0) + (Math.random() - 0.5) * 50,
                     y: (anchorNode.y || 0) + (Math.random() - 0.5) * 50,
                 });
             }

             // Create link from anchor to new work via this person
             // Check if link exists
             const linkExists = links.some(l => 
                (l.source === anchorNode.id && l.target === work.entity && l.person === link.person) ||
                (l.source === work.entity && l.target === anchorNode.id && l.person === link.person)
             ) || newLinks.some(l => l.target === work.entity && l.person === link.person);

             if (!linkExists) {
                newLinks.push({
                    source: anchorNode.id,
                    target: work.entity,
                    person: link.person, // Same person
                    role: work.role,
                    id: `${anchorNode.id}-${work.entity}-${link.person}`,
                    imageUrl: link.imageUrl // Reuse image url we already have
                });
             }
        });

        if (newNodes.length === 0 && newLinks.length === 0) {
             setError(`No other significant works found for ${link.person}.`);
        }

        setNodes(prev => [...prev, ...newNodes]);
        setLinks(prev => {
            const updated = prev.map(l => l.id === link.id ? { ...l, isExpanding: false } : l);
            return [...updated, ...newLinks];
        });

        // Fetch images for new nodes
        // (We don't need to fetch link images because we reused the URL)
        newNodes.forEach(n => {
            loadNodeImage(n.id);
        });

    } catch (e) {
        console.error("Failed to expand person", e);
        setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isExpanding: false } : l));
        setError("Failed to fetch career details.");
    }

  }, [nodes, links, loadNodeImage]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
    if (!node.expanded) {
        expandNode(node);
    }
  };

  const handleViewportChange = useCallback((visibleNodes: GraphNode[]) => {
    // Only fetch images if the number of visible nodes is manageable (LOD)
    if (visibleNodes.length <= 20) {
        visibleNodes.forEach(node => {
            // Check if we need to fetch the image (not already fetched/fetching)
            if (!node.imageUrl && !node.fetchingImage) {
                loadNodeImage(node.id);
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
            <p className="text-slate-400 text-center max-w-md px-4">
                To explore the connections of history, you need to connect your Google AI Studio API key.
            </p>
            <button
                onClick={handleSelectKey}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105"
            >
                <Key size={20} />
                <span>Select API Key</span>
            </button>
            <p className="text-xs text-slate-600 max-w-sm text-center">
                This app uses the Gemini API. Your key is used locally and never stored on our servers.
            </p>
        </div>
    );
  }

  return (
    <div className="relative w-screen h-screen bg-slate-900">
      <Graph 
        nodes={nodes} 
        links={links} 
        onNodeClick={handleNodeClick}
        onLinkClick={handleLinkClick}
        onViewportChange={handleViewportChange}
        width={dimensions.width} 
        height={dimensions.height}
        isCompact={isCompact}
      />
      <ControlPanel 
        onSearch={handleStartSearch} 
        isProcessing={isProcessing} 
        isCompact={isCompact}
        onToggleCompact={() => setIsCompact(!isCompact)}
        error={error}
      />
      <Sidebar selectedNode={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
};

export default App;