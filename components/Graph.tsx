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
}

const Graph: React.FC<GraphProps> = ({ 
  nodes, 
  links, 
  onNodeClick, 
  onLinkClick,
  onViewportChange, 
  width, 
  height,
  isCompact = false 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomGroupRef = useRef<SVGGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Initialize simulation
  useEffect(() => {
    if (!svgRef.current) return;

    // Initialize with standard forces
    const simulation = d3.forceSimulation<GraphNode, GraphLink>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-500)) // Stronger repulsion
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.05)) // Weaker centering
      .force("y", d3.forceY(height / 2).strength(0.05))
      .force("collide", d3.forceCollide().radius(80).iterations(3)); // Larger collision radius and iterations

    simulationRef.current = simulation;

    // Zoom behavior
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
                    n.x >= minX - 50 && n.x <= maxX + 50 && 
                    n.y >= minY - 50 && n.y <= maxY + 50;
           });
           
           onViewportChange(visible);
        }
      });

    d3.select(svgRef.current).call(zoom);

    return () => {
      simulation.stop();
      d3.select(svgRef.current).on(".zoom", null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]); 

  // Update Forces based on isCompact mode
  useEffect(() => {
    if (!simulationRef.current) return;
    const simulation = simulationRef.current;

    const linkForce = simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>;
    const chargeForce = simulation.force("charge") as d3.ForceManyBody<GraphNode>;
    const collideForce = simulation.force("collide") as d3.ForceCollide<GraphNode>;
    const forceX = simulation.force("x") as d3.ForceX<GraphNode>;
    const forceY = simulation.force("y") as d3.ForceY<GraphNode>;

    if (linkForce && chargeForce && collideForce) {
      if (isCompact) {
        linkForce.distance(60);
        chargeForce.strength(-200);
        collideForce.radius(40);
        if (forceX) forceX.strength(0.2);
        if (forceY) forceY.strength(0.2);
      } else {
        linkForce.distance(150); 
        chargeForce.strength(-500); 
        collideForce.radius(80); 
        if (forceX) forceX.strength(0.05); 
        if (forceY) forceY.strength(0.05);
      }
      simulation.alpha(1).restart();
    }
  }, [isCompact]);

  // Update simulation when data changes
  useEffect(() => {
    if (!simulationRef.current || !zoomGroupRef.current) return;

    const simulation = simulationRef.current;
    
    // Sync link references
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    links.forEach(link => {
       if (typeof link.source === 'object' && link.source !== null) {
           const srcId = (link.source as GraphNode).id;
           if (nodeMap.has(srcId)) link.source = nodeMap.get(srcId)!;
       }
       if (typeof link.target === 'object' && link.target !== null) {
           const tgtId = (link.target as GraphNode).id;
           if (nodeMap.has(tgtId)) link.target = nodeMap.get(tgtId)!;
       }
    });

    simulation.nodes(nodes);
    (simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).links(links);
    
    (simulation.force("center") as d3.ForceCenter<GraphNode>).x(width / 2).y(height / 2);
    (simulation.force("x") as d3.ForceX<GraphNode>).x(width / 2);
    (simulation.force("y") as d3.ForceY<GraphNode>).y(height / 2);

    // Restart with high alpha to allow significant layout changes (spreading out)
    simulation.alpha(1).restart();

    const g = d3.select(zoomGroupRef.current);

    // --- LINKS ---
    const linkGroup = g.select(".links");
    const linkElements = linkGroup.selectAll<SVGLineElement, GraphLink>("line")
      .data(links, d => d.id);

    const linkEnter = linkElements.enter().append("line")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1.5);

    const allLinks = linkEnter.merge(linkElements);
    linkElements.exit().remove();

    // --- LINK LABELS (People with Avatars) ---
    const linkLabelGroup = g.select(".link-labels");
    const linkLabelElements = linkLabelGroup.selectAll<SVGGElement, GraphLink>("g")
      .data(links, d => d.id);

    const linkLabelEnter = linkLabelElements.enter().append("g")
        .style("cursor", "pointer")
        .style("pointer-events", "all");

    // 1. Loading Ring (Behind image, shows when expanding)
    linkLabelEnter.append("circle")
        .attr("class", "link-loading-ring")
        .attr("r", 16) // Slightly larger than avatar
        .attr("fill", "none")
        .attr("stroke", "#fbbf24") // Amber for loading actor
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "3 3")
        .attr("opacity", 0);

    // 2. Link Image Background (Circle)
    linkLabelEnter.append("circle")
        .attr("class", "link-avatar-bg")
        .attr("r", 12)
        .attr("fill", "#1e293b")
        .attr("stroke", "#94a3b8")
        .attr("stroke-width", 1.5)
        .transition().duration(200);

    // 3. Link Image (Masked)
    linkLabelEnter.append("clipPath")
        .attr("id", d => `link-clip-${d.id.replace(/[^a-zA-Z0-9]/g, '')}`) 
        .append("circle")
        .attr("r", 12);

    linkLabelEnter.append("image")
        .attr("class", "link-avatar-image")
        .attr("clip-path", d => `url(#link-clip-${d.id.replace(/[^a-zA-Z0-9]/g, '')})`)
        .attr("x", -12)
        .attr("y", -12)
        .attr("width", 24)
        .attr("height", 24)
        .attr("preserveAspectRatio", "xMidYMid slice")
        .attr("opacity", 0);

    // 4. Text Halo
    linkLabelEnter.append("text")
      .attr("class", "halo")
      .attr("dy", 24) 
      .attr("text-anchor", "middle")
      .attr("stroke", "#0f172a") 
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("fill", "#0f172a")
      .attr("font-size", "9px")
      .text(d => d.person);

    // 5. Actual Text
    linkLabelEnter.append("text")
      .attr("class", "text")
      .attr("dy", 24)
      .attr("fill", "#cbd5e1")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("text-anchor", "middle")
      .text(d => d.person);
    
    const allLinkLabels = linkLabelEnter.merge(linkLabelElements);
    
    // Update content and images
    allLinkLabels.select(".halo").text(d => d.person);
    allLinkLabels.select(".text").text(d => d.person);
    
    // Update image
    allLinkLabels.select("clipPath").attr("id", d => `link-clip-${d.id.replace(/[^a-zA-Z0-9]/g, '')}`);
    allLinkLabels.select(".link-avatar-image")
        .attr("clip-path", d => `url(#link-clip-${d.id.replace(/[^a-zA-Z0-9]/g, '')})`)
        .attr("href", d => d.imageUrl || "")
        .attr("opacity", d => d.imageUrl ? 1 : 0);

    // Handle Link Loading State
    allLinkLabels.select(".link-loading-ring")
        .attr("opacity", d => d.isExpanding ? 1 : 0)
        .each(function(d) {
            if (d.isExpanding) {
                d3.select(this).append("animateTransform")
                .attr("attributeName", "transform")
                .attr("type", "rotate")
                .attr("from", "0 0 0")
                .attr("to", "360 0 0")
                .attr("dur", "1.5s")
                .attr("repeatCount", "indefinite");
            } else {
                d3.select(this).selectAll("animateTransform").remove();
            }
        });

    // Handle Hover Effects on links
    allLinkLabels
        .on("mouseenter", function() {
            d3.select(this).select(".link-avatar-bg")
                .attr("stroke", "#fbbf24") // Highlight color
                .attr("stroke-width", 2);
            d3.select(this).select(".text")
                .attr("fill", "#fbbf24");
        })
        .on("mouseleave", function() {
            d3.select(this).select(".link-avatar-bg")
                .attr("stroke", "#94a3b8")
                .attr("stroke-width", 1.5);
            d3.select(this).select(".text")
                .attr("fill", "#cbd5e1");
        })
        .on("click", (event, d) => {
            event.stopPropagation();
            if (onLinkClick) onLinkClick(d);
        });

    linkLabelElements.exit().remove();

    // --- NODES (Shapes only) ---
    const nodeGroup = g.select(".nodes");
    const nodeElements = nodeGroup.selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, d => d.id);

    const nodeEnter = nodeElements.enter().append("g")
      .attr("cursor", "pointer")
      .call(d3.drag<SVGGElement, GraphNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    // 1. Background Circle
    nodeEnter.append("circle")
      .attr("class", "node-bg")
      .attr("r", 20)
      .attr("fill", "#0f172a") 
      .attr("stroke", "none");

    // 2. Image (Masked)
    nodeEnter.append("clipPath")
      .attr("id", d => `clip-${d.index}`) 
      .append("circle")
      .attr("r", 20);

    nodeEnter.append("image")
      .attr("class", "node-image")
      .attr("clip-path", d => `url(#clip-${d.index})`)
      .attr("x", -20)
      .attr("y", -20)
      .attr("width", 40)
      .attr("height", 40)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("opacity", 0); 

    // 3. Border Circle
    nodeEnter.append("circle")
      .attr("class", "node-border")
      .attr("r", 20)
      .attr("fill", "none")
      .attr("stroke", "#3b82f6")
      .attr("stroke-width", 2);

    // 4. Loading Indicator Ring
    nodeEnter.append("circle")
      .attr("class", "loading-ring")
      .attr("r", 24)
      .attr("fill", "none")
      .attr("stroke", "#22d3ee") 
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 4")
      .attr("opacity", 0); 

    const allNodes = nodeEnter.merge(nodeElements);
    
    allNodes.select(".node-image")
        .attr("href", d => d.imageUrl || "")
        .attr("opacity", d => d.imageUrl ? 1 : 0);
    
    allNodes.select("clipPath").attr("id", d => `clip-${d.index}`);
    allNodes.select(".node-image").attr("clip-path", d => `url(#clip-${d.index})`);

    allNodes.select(".loading-ring")
      .attr("opacity", d => d.isLoading ? 1 : 0)
      .each(function(d) {
        if (d.isLoading) {
           d3.select(this).append("animateTransform")
            .attr("attributeName", "transform")
            .attr("type", "rotate")
            .attr("from", "0 0 0")
            .attr("to", "360 0 0")
            .attr("dur", "2s")
            .attr("repeatCount", "indefinite");
        } else {
            d3.select(this).selectAll("animateTransform").remove();
        }
      });
      
    allNodes.select(".node-bg")
       .attr("fill", d => d.expanded ? "#1e293b" : "#0f172a");

    allNodes.select(".node-border")
       .attr("stroke", d => d.isLoading ? "#22d3ee" : (d.expanded ? "#64748b" : "#3b82f6"));

    // Events
    allNodes.on("click", (event, d) => {
      event.stopPropagation();
      onNodeClick(d);
    });
    
    allNodes.on("mouseover", (e, d) => setHoveredNode(d));
    allNodes.on("mouseout", () => setHoveredNode(null));

    nodeElements.exit().remove();

    // --- NODE LABELS (Text) ---
    const nodeLabelGroup = g.select(".node-labels");
    const nodeLabelElements = nodeLabelGroup.selectAll<SVGGElement, GraphNode>("g")
        .data(nodes, d => d.id);

    const nodeLabelEnter = nodeLabelElements.enter().append("g")
        .style("pointer-events", "none");

    // Title Label
    nodeLabelEnter.append("text")
      .attr("class", "label-halo")
      .attr("dy", 35)
      .attr("text-anchor", "middle")
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 4)
      .attr("stroke-linejoin", "round")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .text(d => d.id);

    nodeLabelEnter.append("text")
      .attr("class", "label-text")
      .attr("dy", 35)
      .attr("text-anchor", "middle")
      .attr("fill", "#e2e8f0")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .text(d => d.id);

    // Type Label
    nodeLabelEnter.append("text")
      .attr("class", "type-halo")
      .attr("dy", 48)
      .attr("text-anchor", "middle")
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("font-size", "10px")
      .text(d => d.type);

    nodeLabelEnter.append("text")
      .attr("class", "type-text")
      .attr("dy", 48)
      .attr("text-anchor", "middle")
      .attr("fill", "#64748b")
      .attr("font-size", "10px")
      .text(d => d.type);

    const allNodeLabels = nodeLabelEnter.merge(nodeLabelElements);
    
    allNodeLabels.select(".label-halo").text(d => d.id);
    allNodeLabels.select(".label-text").text(d => d.id);
    allNodeLabels.select(".type-halo").text(d => d.type);
    allNodeLabels.select(".type-text").text(d => d.type);

    nodeLabelElements.exit().remove();

    // Simulation Tick
    simulation.on("tick", () => {
      allLinks
        .attr("x1", d => (d.source as GraphNode).x!)
        .attr("y1", d => (d.source as GraphNode).y!)
        .attr("x2", d => (d.target as GraphNode).x!)
        .attr("y2", d => (d.target as GraphNode).y!);

      // Link labels position (midpoint)
      allLinkLabels
        .attr("transform", d => {
            const sx = (d.source as GraphNode).x!;
            const sy = (d.source as GraphNode).y!;
            const tx = (d.target as GraphNode).x!;
            const ty = (d.target as GraphNode).y!;
            return `translate(${(sx + tx) / 2}, ${(sy + ty) / 2})`;
        });

      allNodes.attr("transform", d => `translate(${d.x},${d.y})`);
      allNodeLabels.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any, d: GraphNode) {
      if (!event.active) simulation?.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: GraphNode) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: GraphNode) {
      if (!event.active) simulation?.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

  }, [nodes, links, onNodeClick, onLinkClick, width, height]); 

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      <svg ref={svgRef} width={width} height={height} className="block cursor-move">
        <g ref={zoomGroupRef}>
          <g className="links"></g>
          <g className="link-labels"></g> 
          <g className="nodes"></g>
          <g className="node-labels"></g> 
        </g>
      </svg>
      
      <div className="absolute bottom-4 left-4 pointer-events-none">
        <div className="bg-slate-800/80 backdrop-blur text-slate-300 px-4 py-2 rounded-lg border border-slate-700 text-sm">
            {hoveredNode ? (
                <span>
                    <strong>{hoveredNode.id}</strong> ({hoveredNode.type})
                    {hoveredNode.expanded ? " • Connections explored" : " • Click to explore"}
                </span>
            ) : (
                <span>Drag to pan • Scroll to zoom • Click node to expand • Click person to see career</span>
            )}
        </div>
      </div>
    </div>
  );
};

export default Graph;