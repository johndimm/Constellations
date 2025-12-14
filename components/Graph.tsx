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
          const baseHeight = 50; // Title + Padding
          const imgHeight = node.imageUrl ? 120 : 0;
          const descHeight = node.description ? 45 : 0; 
          return { 
              w: 220, 
              h: baseHeight + imgHeight + descHeight, 
              r: 120, // Collision radius
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
          // Approx char width 7px for description font
          if ((currentLine + " " + word).length * 7 < width) {
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

    const collideForce = d3.forceCollide<GraphNode>()
        .radius(d => getNodeDimensions(d, isTimelineMode).r + 5)
        .strength(0.8)
        .iterations(3);

    simulation.force("collidePeople", null);
    simulation.force("collideEvents", null);
    simulation.force("collide", collideForce);

    if (isTimelineMode) {
        // --- Timeline Mode (Ordinal Sequence) ---
        const timelineNodes = nodes
            .filter(n => n.year !== undefined)
            .sort((a, b) => (Number(a.year ?? 0) - Number(b.year ?? 0)) || a.id.localeCompare(b.id));

        const nodeIndexMap = new Map<string, number>(
            timelineNodes.map((n, i) => [n.id, i] as [string, number])
        );
        const itemSpacing = 240; // Horizontal spacing
        const totalWidth = timelineNodes.length * itemSpacing;
        const startX = -(totalWidth / 2) + (itemSpacing / 2); // Center the sequence

        if (centerForce) centerForce.strength(0.01); 
        if (chargeForce) chargeForce.strength(-300);

        if (linkForce) linkForce.strength(0.15).distance(120); 

        simulation.force("x", d3.forceX<GraphNode>((d) => {
            if (nodeIndexMap.has(d.id)) {
                const index = nodeIndexMap.get(d.id)!;
                return width / 2 + startX + (index * itemSpacing);
            }
            return width / 2;
        }).strength((d) => {
            if (nodeIndexMap.has(d.id)) return 0.95; 
            return 0.02; 
        }));

        simulation.force("y", d3.forceY<GraphNode>((d) => {
             if (nodeIndexMap.has(d.id)) {
                 const index = nodeIndexMap.get(d.id)!;
                 // Alternating Up/Down
                 const offset = (index % 2 === 0) ? -120 : 120;
                 return (height / 2) + offset;
             }
             return height / 2;
        }).strength((d) => {
            if (nodeIndexMap.has(d.id)) return 1; 
            return 0.01; 
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

    // Sync positions from simulation
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

    // LINKS
    const linkSel = container.selectAll<SVGLineElement, GraphLink>(".link").data(links, d => d.id);
    linkSel.enter().insert("line", ".node")
        .attr("class", "link")
        .attr("stroke", "#475569")
        .attr("stroke-opacity", 0.4)
        .attr("stroke-width", 1.5);
    linkSel.exit().remove();

    // NODES
    // 1. Bind Data
    const nodeSel = container.selectAll<SVGGElement, GraphNode>(".node").data(nodes, d => d.id);
    
    // 2. Enter
    const nodeEnter = nodeSel.enter().append("g")
        .attr("class", "node")
        .call(d3.drag<SVGGElement, GraphNode>()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    nodeEnter.append("circle")
        .attr("class", "node-circle")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);

    nodeEnter.append("rect")
        .attr("class", "node-rect")
        .attr("rx", 0)
        .attr("ry", 0)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);

    const defs = nodeEnter.append("defs");
    defs.append("clipPath")
        .attr("id", d => `clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`)
        .append("circle").attr("cx", 0).attr("cy", 0);
    
    defs.append("clipPath")
        .attr("id", d => `clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`)
        .append("rect").attr("x", 0).attr("y", 0); 

    nodeEnter.append("image").style("pointer-events", "none").attr("preserveAspectRatio", "xMidYMid slice");
    
    nodeEnter.append("text")
        .attr("class", "node-label")
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("font-family", "sans-serif")
        .style("pointer-events", "none")
        .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")
        .attr("fill", "#e2e8f0");
    
    nodeEnter.append("text")
        .attr("class", "node-desc")
        .attr("text-anchor", "middle")
        .style("font-family", "sans-serif")
        .style("pointer-events", "none")
        .attr("fill", "#fff");

    nodeEnter.append("text")
        .attr("class", "year-label")
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("font-family", "monospace")
        .style("pointer-events", "none")
        .attr("fill", "#fbbf24");

    // SPINNER
    const spinner = nodeEnter.append("g").attr("class", "spinner-group").style("display", "none");
    spinner.append("circle")
        .attr("class", "spinner")
        .attr("fill", "none")
        .attr("stroke", "#a78bfa") // purple-400
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", "10 15")
        .attr("stroke-linecap", "round");
    
    spinner.append("animateTransform")
         .attr("attributeName", "transform")
         .attr("type", "rotate")
         .attr("from", "0 0 0")
         .attr("to", "360 0 0")
         .attr("dur", "2s")
         .attr("repeatCount", "indefinite");

    // 3. Exit
    nodeSel.exit().remove();

    // 4. Update (Enter + Update)
    const allNodes = nodeEnter.merge(nodeSel);
    
    // Sort logic to keep people on top
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
        g.select(".spinner-group").style("display", "none");

        // Determine spinner state
        const showSpinner = d.isLoading;
        
        if (dims.type === 'circle') {
            const r = dims.w / 2;
            g.select(".node-circle")
                .style("display", "block")
                .attr("r", r)
                .attr("fill", color)
                .attr("stroke", isHovered ? "#f59e0b" : "#fff")
                .style("opacity", (d.fetchingImage) ? 0.7 : 1);

            g.select("image")
                .style("display", d.imageUrl ? "block" : "none")
                .attr("href", d.imageUrl || "")
                .attr("x", -r).attr("y", -r)
                .attr("width", r * 2).attr("height", r * 2)
                .attr("clip-path", `url(#clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`)
                .style("opacity", (d.fetchingImage) ? 0.7 : 1);
            
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

        } else {
            const w = dims.w;
            const h = dims.h;
            
            g.select(".node-rect")
                .style("display", "block")
                .attr("width", w).attr("height", h)
                .attr("x", -w/2).attr("y", -h/2)
                .attr("fill", color)
                .attr("stroke", isHovered ? "#f59e0b" : "#fff")
                .style("opacity", (d.fetchingImage) ? 0.7 : 1);

            if (dims.type === 'card' && d.imageUrl) {
                 const imgH = 120;
                 g.select("image")
                    .style("display", "block")
                    .attr("href", d.imageUrl)
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", imgH)
                    .attr("clip-path", `url(#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`)
                    .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                 g.select(`#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("rect")
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", imgH)
                    .attr("rx", 0);
            } else if (dims.type === 'box' && d.imageUrl) {
                 g.select("image")
                    .style("display", "block")
                    .attr("href", d.imageUrl)
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", h)
                    .attr("clip-path", `url(#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`)
                    .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                 g.select(`#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("rect")
                    .attr("x", -w/2).attr("y", -h/2)
                    .attr("width", w).attr("height", h)
                    .attr("rx", 0);
            } else {
                g.select("image").style("display", "none");
            }

            let textY = 0;
            if (dims.type === 'card') {
                const imgOffset = d.imageUrl ? 120 : 0;
                // Start text below image
                textY = -h/2 + imgOffset + 18; 
                
                // Wrap text for description (width 200px approx)
                const descLines = wrapText(d.description || "", 190);
                g.select(".node-desc")
                    .style("display", "block")
                    .style("font-size", "12px") 
                    .style("font-weight", "500")
                    .attr("y", textY + 16)
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
                .style("font-size", dims.type === 'card' ? "13px" : "10px")
                .style("font-weight", dims.type === 'card' ? "bold" : "normal");

            g.select(".year-label")
                .text(d.year || "")
                .attr("y", -h/2 - 10)
                .style("display", (isTimelineMode || isHovered) && d.year ? "block" : "none");
        }
        
        // Update Spinner Position
        const spinnerR = (dims.type === 'circle' || dims.type === 'box') ? (dims.w / 2) + 8 : (dims.h / 2) + 10;
        g.select(".spinner-group")
            .style("display", showSpinner ? "block" : "none")
            .select(".spinner").attr("r", spinnerR);
    });

    // Events
    allNodes
        .on("click", (event, d) => {
            if (event.defaultPrevented) return;
            event.stopPropagation();
            onNodeClick(d);
        })
        .on("mouseover", (e, d) => setHoveredNode(d))
        .on("mouseout", () => setHoveredNode(null));

    // Simulation restart
    simulation.nodes(nodes);
    (simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).links(links);
    
    const hasStructureChanged = nodes.length !== prevNodesLen.current || links.length !== prevLinksLen.current;
    if (hasStructureChanged) {
        simulation.alpha(1).restart();
    } else {
        simulation.alpha(0.3).restart();
    }
    
    prevNodesLen.current = nodes.length;
    prevLinksLen.current = links.length;

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