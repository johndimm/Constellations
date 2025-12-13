import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphLink } from '../types';

interface GraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
  onLinkClick?: (link: GraphLink) => void;
  onViewportChange?: (visibleNodes: GraphNode[]) => void;
  width: number;
  height: number;
  isCompact?: boolean;
  isTimelineMode?: boolean;
}

const Graph: React.FC<GraphProps> = ({ 
  nodes, 
  links, 
  onNodeClick, 
  onLinkClick,
  onViewportChange, 
  width, 
  height,
  isCompact = false,
  isTimelineMode = false
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomGroupRef = useRef<SVGGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  
  // Track previous data sizes to optimize simulation restarts
  const prevNodesLen = useRef(nodes.length);
  const prevLinksLen = useRef(links.length);

  // Helper functions for Drag
  function dragstarted(event: any, d: GraphNode) {
    if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event: any, d: GraphNode) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event: any, d: GraphNode) {
    if (!event.active) simulationRef.current?.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  function getNodeColor(type: string) {
      if (type === 'Origin') return '#ef4444'; 
      if (type === 'Person') return '#f59e0b';
      return '#3b82f6';
  }

  // Calculate dynamic dimensions for nodes
  const getNodeDimensions = (node: GraphNode, isTimeline: boolean): { w: number, h: number, r: number, type: string } => {
      if (node.type === 'Person') {
          return { w: 48, h: 48, r: 35, type: 'circle' }; // r is collision radius
      }
      
      // Events/Things
      if (isTimeline) {
          // Timeline Card Mode
          const baseHeight = 80; // Title + Padding (Increased for readability)
          const imgHeight = node.imageUrl ? 100 : 0;
          const descHeight = node.description ? 50 : 0; // More room for description
          return { 
              w: 200, // Slightly wider
              h: baseHeight + imgHeight + descHeight, 
              r: 130, // Collision radius
              type: 'card' 
          };
      } else {
          // Compact/Graph Mode
          if (node.imageUrl) {
               return { w: 60, h: 60, r: 40, type: 'box' };
          }
          // Pill Mode
          const textLen = (node.id.length * 8) + 24;
          return { w: textLen, h: 32, r: textLen / 2 + 10, type: 'pill' };
      }
  };

  // Helper to wrap text in SVG
  const wrapText = (text: string, width: number) => {
      if (!text) return [];
      const words = text.split(/\s+/);
      const lines = [];
      let currentLine = words[0];
      
      for (let i = 1; i < words.length; i++) {
          const word = words[i];
          // Approx char width 8px for description font
          if ((currentLine + " " + word).length * 8 < width) {
              currentLine += " " + word;
          } else {
              lines.push(currentLine);
              currentLine = word;
          }
      }
      lines.push(currentLine);
      return lines.slice(0, 3); // Max 3 lines
  };

  // Initialize simulation
  useEffect(() => {
    if (!svgRef.current) return;

    const simulation = d3.forceSimulation<GraphNode, GraphLink>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .velocityDecay(0.4); 

    // Note: 'collide' force is added dynamically in the next useEffect

    simulationRef.current = simulation;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        if (zoomGroupRef.current) {
          d3.select(zoomGroupRef.current).attr("transform", event.transform);
        }
      })
      .on("end", (event) => {
        if (onViewportChange) {
           const t = event.transform;
           const minX = -t.x / t.k;
           const maxX = (width - t.x) / t.k;
           const minY = -t.y / t.k;
           const maxY = (height - t.y) / t.k;

           const visible = nodes.filter(n => {
             return n.x !== undefined && n.y !== undefined &&
                    n.x >= minX - 100 && n.x <= maxX + 100 && 
                    n.y >= minY - 100 && n.y <= maxY + 100;
           });
           
           onViewportChange(visible);
        }
      });

    d3.select(svgRef.current).call(zoom).on("dblclick.zoom", null);

    return () => {
      simulation.stop();
      d3.select(svgRef.current).on(".zoom", null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]); 

  // Handle Mode Switching and Forces
  useEffect(() => {
    if (!simulationRef.current) return;
    const simulation = simulationRef.current;

    const linkForce = simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>;
    const chargeForce = simulation.force("charge") as d3.ForceManyBody<GraphNode>;
    const centerForce = simulation.force("center") as d3.ForceCenter<GraphNode>;

    // Unified Collision Force: Ensures People don't sit on top of Events
    const collideForce = d3.forceCollide<GraphNode>()
        .radius(d => getNodeDimensions(d, isTimelineMode).r + 5)
        .strength(0.8)
        .iterations(3);

    // Remove old split forces if they existed
    simulation.force("collidePeople", null);
    simulation.force("collideEvents", null);
    
    // Apply unified collision
    simulation.force("collide", collideForce);

    if (isTimelineMode) {
        // --- Timeline Mode (Ordinal Sequence) ---
        
        // 1. Identify and Sort Timeline Items
        const timelineNodes = nodes
            .filter(n => n.year !== undefined)
            .sort((a, b) => ((a.year ?? 0) - (b.year ?? 0)) || a.id.localeCompare(b.id));

        // 2. Map ID to Rank
        const nodeIndexMap = new Map(timelineNodes.map((n, i) => [n.id, i]));
        const itemSpacing = 240; // Horizontal spacing
        const totalWidth = timelineNodes.length * itemSpacing;
        const startX = -(totalWidth / 2) + (itemSpacing / 2); // Center the sequence

        // Disable center force to allow timeline spread
        if (centerForce) centerForce.strength(0.01); 
        if (chargeForce) chargeForce.strength(-300); // Stronger repulsion to clear space

        // Link Force: Loose enough to let people float
        if (linkForce) linkForce.strength(0.15).distance(120); 

        // X Force: STRICT ORDINAL POSITIONING for events
        simulation.force("x", d3.forceX<GraphNode>((d) => {
            if (nodeIndexMap.has(d.id)) {
                const index = nodeIndexMap.get(d.id)!;
                return width / 2 + startX + (index * itemSpacing);
            }
            return width / 2; // People loosely centered horizontally
        }).strength((d) => {
            if (nodeIndexMap.has(d.id)) return 0.95; 
            return 0.02; 
        }));

        // Y Force: Zig-Zag for events, free flow for people
        simulation.force("y", d3.forceY<GraphNode>((d) => {
             if (nodeIndexMap.has(d.id)) {
                 const index = nodeIndexMap.get(d.id)!;
                 // Alternating Up/Down offset to use vertical space
                 const offset = (index % 2 === 0) ? -120 : 120;
                 return (height / 2) + offset;
             }
             return height / 2;
        }).strength((d) => {
            if (nodeIndexMap.has(d.id)) return 1; // Strict Y lock
            return 0.01; // People flow vertically very freely
        }));

    } else {
        // --- Graph Mode ---
        if (centerForce) centerForce.x(width / 2).y(height / 2).strength(0.8);
        if (chargeForce) chargeForce.strength(isCompact ? -200 : -600);
        if (linkForce) linkForce.strength(1).distance(isCompact ? 60 : 150);
        
        simulation.force("x", null);
        simulation.force("y", null);
    }

    simulation.alpha(0.3).restart();
  }, [isTimelineMode, isCompact, nodes, width, height]);

  // Update DOM & Styles
  useEffect(() => {
    if (!simulationRef.current || !zoomGroupRef.current) return;
    const simulation = simulationRef.current;
    const container = d3.select(zoomGroupRef.current);

    // Sync positions
    const oldNodesMap = new Map<string, GraphNode>(simulation.nodes().map(n => [n.id, n]));
    nodes.forEach(node => {
        const old = oldNodesMap.get(node.id);
        if (old) {
            node.x = old.x;
            node.y = old.y;
            node.vx = old.vx;
            node.vy = old.vy;
            node.fx = old.fx;
            node.fy = old.fy;
        }
    });

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    links.forEach(link => {
       let srcId = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source as string;
       let tgtId = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target as string;
       if (nodeMap.has(srcId)) link.source = nodeMap.get(srcId)!;
       if (nodeMap.has(tgtId)) link.target = nodeMap.get(tgtId)!;
    });

    // --- DRAWING LINKS ---
    const linkSel = container.selectAll<SVGLineElement, GraphLink>(".link").data(links, d => d.id);
    linkSel.enter().insert("line", ".node")
        .attr("class", "link")
        .attr("stroke", "#475569")
        .attr("stroke-opacity", 0.4)
        .attr("stroke-width", 1.5);
    linkSel.exit().remove();

    // --- DRAWING NODES ---
    const nodeSel = container.selectAll<SVGGElement, GraphNode>(".node").data(nodes, d => d.id);
    const nodeEnter = nodeSel.enter().append("g")
        .attr("class", "node")
        .call(d3.drag<SVGGElement, GraphNode>()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    // Structure for Person (Circle)
    nodeEnter.append("circle")
        .attr("class", "node-circle")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);

    // Structure for Event (Rect)
    nodeEnter.append("rect")
        .attr("class", "node-rect")
        .attr("rx", 12)
        .attr("ry", 12)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);

    // Image Clip Paths (Circle vs Rect)
    const defs = nodeEnter.append("defs");
    defs.append("clipPath")
        .attr("id", d => `clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`)
        .append("circle").attr("cx", 0).attr("cy", 0);
    
    defs.append("clipPath")
        .attr("id", d => `clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`)
        .append("rect").attr("x", 0).attr("y", 0); 

    nodeEnter.append("image").style("pointer-events", "none").attr("preserveAspectRatio", "xMidYMid slice");
    
    // Labels
    nodeEnter.append("text")
        .attr("class", "node-label")
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("font-family", "sans-serif")
        .style("pointer-events", "none")
        .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")
        .attr("fill", "#e2e8f0");
    
    // Description (Event Timeline only)
    nodeEnter.append("text")
        .attr("class", "node-desc")
        .attr("text-anchor", "middle")
        .style("font-family", "sans-serif")
        .style("pointer-events", "none")
        .attr("fill", "#cbd5e1"); // Lighter color for better readability

    // Year Label
    nodeEnter.append("text")
        .attr("class", "year-label")
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("font-family", "monospace")
        .style("pointer-events", "none")
        .attr("fill", "#fbbf24");

    const spinner = nodeEnter.append("g").attr("class", "spinner-group").style("display", "none");
    spinner.append("circle")
        .attr("class", "spinner")
        .attr("fill", "none")
        .attr("stroke", "#6366f1")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4 4");
    spinner.append("animateTransform")
         .attr("attributeName", "transform")
         .attr("type", "rotate")
         .attr("from", "0 0 0")
         .attr("to", "360 0 0")
         .attr("dur", "2s")
         .attr("repeatCount", "indefinite");

    nodeSel.exit().remove();

    // --- UPDATING VISUALS (The heavy lifting) ---
    const allNodes = container.selectAll<SVGGElement, GraphNode>(".node");
    
    // We re-bind data to ensure updates
    allNodes.data(nodes, d => d.id);

    // Z-INDEX SORT: Ensure People are drawn LAST (on top)
    allNodes.sort((a, b) => {
        const aIsPerson = a.type === 'Person';
        const bIsPerson = b.type === 'Person';
        if (aIsPerson && !bIsPerson) return 1;
        if (!aIsPerson && bIsPerson) return -1;
        return 0;
    });

    allNodes.each(function(d) {
        const g = d3.select(this);
        const dims = getNodeDimensions(d, isTimelineMode);
        const isHovered = d.id === hoveredNode?.id;
        const color = getNodeColor(d.type);

        // Reset visibility
        g.select(".node-circle").style("display", "none");
        g.select(".node-rect").style("display", "none");
        g.select(".node-desc").style("display", "none");
        
        // --- PERSON RENDER ---
        if (dims.type === 'circle') {
            const r = dims.w / 2;
            g.select(".node-circle")
                .style("display", "block")
                .attr("r", r)
                .attr("fill", color)
                .attr("stroke", isHovered ? "#f59e0b" : "#fff");

            g.select("image")
                .style("display", d.imageUrl ? "block" : "none")
                .attr("href", d.imageUrl || "")
                .attr("x", -r).attr("y", -r)
                .attr("width", r * 2).attr("height", r * 2)
                .attr("clip-path", `url(#clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`);
            
            // Clip Update
            g.select(`#clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("circle").attr("r", r);

            g.select(".node-label")
                .text(d.id)
                .attr("y", r + 15)
                .attr("dy", 0)
                .style("font-size", "10px");
                
            g.select(".year-label")
                .text(d.year || "")
                .attr("y", -r - 10)
                .style("display", (isTimelineMode || isHovered) && d.year ? "block" : "none");

        } 
        // --- EVENT RENDER ---
        else {
            const w = dims.w;
            const h = dims.h;
            
            g.select(".node-rect")
                .style("display", "block")
                .attr("width", w).attr("height", h)
                .attr("x", -w/2).attr("y", -h/2)
                .attr("fill", color)
                .attr("stroke", isHovered ? "#f59e0b" : "#fff");

            // Image handling for Event
            if (dims.type === 'card' && d.imageUrl) {
                 const imgH = 100;
                 g.select("image")
                    .style("display", "block")
                    .attr("href", d.imageUrl)
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", imgH)
                    .attr("clip-path", `url(#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`);

                 // Update clip rect
                 g.select(`#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("rect")
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", imgH)
                    .attr("rx", 10);
            } else if (dims.type === 'box' && d.imageUrl) {
                 g.select("image")
                    .style("display", "block")
                    .attr("href", d.imageUrl)
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", h)
                    .attr("clip-path", `url(#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`);

                 g.select(`#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("rect")
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", h)
                    .attr("rx", 10);
            } else {
                g.select("image").style("display", "none");
            }

            // Text Positioning
            let textY = 0;
            if (dims.type === 'card') {
                textY = d.imageUrl ? (-h/2 + 100 + 20) : -h/2 + 30;
                
                // Show Description
                const descLines = wrapText(d.description || "", 24); // ~24 chars wide
                g.select(".node-desc")
                    .style("display", "block")
                    .style("font-size", "11px") // Increased font size
                    .style("font-weight", "400")
                    .attr("y", textY + 15)
                    .selectAll("tspan").remove(); 
                
                const descText = g.select(".node-desc");
                descLines.forEach((line, i) => {
                    descText.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : "1.2em").text(line);
                });
            } else if (dims.type === 'box') {
                textY = 45; 
            } else {
                textY = 4;
            }

            g.select(".node-label")
                .text(d.id)
                .attr("y", textY)
                .attr("dy", 0)
                .style("font-size", dims.type === 'card' ? "13px" : "10px") // Slightly bigger title
                .style("font-weight", dims.type === 'card' ? "bold" : "normal");

            g.select(".year-label")
                .text(d.year || "")
                .attr("y", -h/2 - 10)
                .style("display", (isTimelineMode || isHovered) && d.year ? "block" : "none");
        }
        
        // Spinner always centers
        g.select(".spinner-group")
            .style("display", (d.isLoading || d.fetchingImage) ? "block" : "none")
            .select(".spinner").attr("r", 15);
    });

    // RE-ATTACH CLICK LISTENERS
    allNodes
        .on("click", (event, d) => {
            if (event.defaultPrevented) return;
            event.stopPropagation();
            onNodeClick(d);
        })
        .on("mouseover", (e, d) => setHoveredNode(d))
        .on("mouseout", () => setHoveredNode(null));

    simulation.nodes(nodes);
    (simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).links(links);
    
    // Prevent violent restart if just metadata changed
    const hasStructureChanged = nodes.length !== prevNodesLen.current || links.length !== prevLinksLen.current;
    if (hasStructureChanged) {
        simulation.alpha(1).restart();
    } else {
        simulation.alpha(0.3).restart();
    }
    
    prevNodesLen.current = nodes.length;
    prevLinksLen.current = links.length;

    // Axis Layer (Only create once)
    let axisGroup = container.select<SVGGElement>(".timeline-axis");
    if (axisGroup.empty()) {
        axisGroup = container.insert("g", ":first-child").attr("class", "timeline-axis");
        axisGroup.append("line")
            .attr("stroke", "#64748b").attr("stroke-width", 1).attr("stroke-dasharray", "5,5");
    }

    const allLinks = container.selectAll<SVGLineElement, GraphLink>(".link");
    
    simulation.on("tick", () => {
        allLinks
            .attr("x1", d => (d.source as GraphNode).x!)
            .attr("y1", d => (d.source as GraphNode).y!)
            .attr("x2", d => (d.target as GraphNode).x!)
            .attr("y2", d => (d.target as GraphNode).y!);

        allNodes.attr("transform", d => `translate(${d.x},${d.y})`);
        
        if (isTimelineMode) {
             const years = nodes.map(n => n.year).filter((y): y is number => y !== undefined);
             if (years.length > 0) {
                 axisGroup.style("display", "block");
                 axisGroup.select("line")
                      .attr("x1", -width * 4).attr("y1", height/2) 
                      .attr("x2", width * 4).attr("y2", height/2);
             }
        } else {
             axisGroup.style("display", "none");
        }
    });

  }, [nodes, links, isTimelineMode, width, height, hoveredNode, onNodeClick]);

  return (
    <svg 
      ref={svgRef} 
      width={width} 
      height={height} 
      className="cursor-move bg-slate-900"
      onClick={() => setHoveredNode(null)}
    >
      <g ref={zoomGroupRef} />
    </svg>
  );
};

export default Graph;