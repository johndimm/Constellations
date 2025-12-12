import React, { useState, useEffect, useCallback } from 'react';
import Graph from './components/Graph';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import { GraphNode, GraphLink } from './types';
import { fetchConnections, fetchPersonWorks } from './services/geminiService';
import { fetchWikipediaImage } from './services/wikipediaService';
import { Key } from 'lucide-react';

// Helper to safely retrieve key from various environment variable standards
const getEnvApiKey = () => {
    let key = "";
    
    // 1. Try import.meta.env (Vite standard)
    // We access properties directly so Vite can statically replace them
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            // @ts-ignore
            key = import.meta.env.VITE_API_KEY || 
                  // @ts-ignore
                  import.meta.env.NEXT_PUBLIC_API_KEY || 
                  // @ts-ignore
                  import.meta.env.API_KEY ||
                  "";
        }
    } catch (e) {
        // import.meta ignored
    }

    if (key) return key;

    // 2. Try process.env (Legacy/Webpack/Next.js)
    try {
        if (typeof process !== 'undefined' && process.env) {
            key = process.env.VITE_API_KEY || 
                  process.env.NEXT_PUBLIC_API_KEY || 
                  process.env.REACT_APP_API_KEY || 
                  process.env.API_KEY || 
                  "";
        }
    } catch (e) {
        // process ignored
    }

    return key;
};

const App: React.FC = () => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [error, setError] = useState<string | null>(null);
  const [isKeyReady, setIsKeyReady] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      const logs: string[] = [];
      const log = (msg: string) => {
          console.log(msg);
          logs.push(msg);
      };

      log("DEBUG [v3]: Checking for API Key..."); 
      
      const envKey = getEnvApiKey();
      log(`DEBUG [v3]: Resolved Key Length: ${envKey ? envKey.length : 0}`);

      // If running in an environment with the aistudio helper (Project IDX/AI Studio)
      if ((window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        log(`DEBUG [v3]: AI Studio Key Present: ${hasKey}`);
        setIsKeyReady(hasKey || !!envKey);
      } else {
        if (envKey) {
            log("DEBUG [v3]: Using Environment Variable Key");
            setIsKeyReady(true);
        } else {
            log("DEBUG [v3]: No API Key found.");
        }
      }
      setDebugLog(logs);
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
      if ((window as any).aistudio) {
          await (window as any).aistudio.openSelectKey();
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

    setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: true } : n));
    setIsProcessing(true);
    setError(null);

    try {
      const data = await fetchConnections(node.id);
      
      if (data.connections.length === 0) {
        if (isInitial) {
             setError(`No connections found for "${node.id}". Try a different topic.`);
             setNodes([]);
             setSelectedNode(null);
        } else {
             setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isLoading: false, expanded: true } : n)); 
        }
        setIsProcessing(false);
        return;
      }

      const newNodes: GraphNode[] = [];
      const newLinks: GraphLink[] = [];

      data.connections.forEach((conn) => {
        const existingNode = nodes.find(n => n.id === conn.connectedEntity) || newNodes.find(n => n.id === conn.connectedEntity);
        let targetNodeId = conn.connectedEntity;

        if (!existingNode) {
            const newNode: GraphNode = {
                id: conn.connectedEntity,
                type: conn.connectedEntityType,
                description: conn.entityDescription,
                x: (node.x || 0) + (Math.random() - 0.5) * 100,
                y: (node.y || 0) + (Math.random() - 0.5) * 100,
            };
            newNodes.push(newNode);
        }

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

      setNodes(prev => {
         const updated = prev.map(n => n.id === node.id ? { ...n, isLoading: false, expanded: true } : n);
         return [...updated, ...newNodes];
      });
      setLinks(prev => [...prev, ...newLinks]);

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

    setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isExpanding: true } : l));
    setError(null);

    try {
        const data = await fetchPersonWorks(link.person);
        const anchorNode = typeof link.source === 'object' ? link.source as GraphNode : nodes.find(n => n.id === link.source);
        
        if (!anchorNode) {
            setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isExpanding: false } : l));
            return;
        }

        const newNodes: GraphNode[] = [];
        const newLinks: GraphLink[] = [];

        data.works.forEach(work => {
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

             const linkExists = links.some(l => 
                (l.source === anchorNode.id && l.target === work.entity && l.person === link.person) ||
                (l.source === work.entity && l.target === anchorNode.id && l.person === link.person)
             ) || newLinks.some(l => l.target === work.entity && l.person === link.person);

             if (!linkExists) {
                newLinks.push({
                    source: anchorNode.id,
                    target: work.entity,
                    person: link.person, 
                    role: work.role,
                    id: `${anchorNode.id}-${work.entity}-${link.person}`,
                    imageUrl: link.imageUrl 
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
    if (visibleNodes.length <= 20) {
        visibleNodes.forEach(node => {
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
            
            {/* DEBUG INFO OVERLAY */}
            <div className="mt-8 p-4 bg-black/50 rounded-lg text-xs font-mono text-slate-400 max-w-lg w-full overflow-hidden">
                <p className="font-bold text-slate-200 mb-2 border-b border-slate-700 pb-1">Debug Info (v3)</p>
                {debugLog.map((l, i) => <div key={i}>{l}</div>)}
                <div className="mt-2 text-yellow-500">
                    Warning: If you see "process.env.API_KEY value: undefined" in console, you are running an old cached version. Hard refresh or redeploy.
                </div>
            </div>
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