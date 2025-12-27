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
    isTextOnly?: boolean;
    searchId?: number;
    selectedNode?: GraphNode | null;
    highlightKeepIds?: number[];
    highlightDropIds?: number[];
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
    isTimelineMode = false,
    isTextOnly = false,
    searchId = 0,
    selectedNode = null,
    highlightKeepIds = [],
    highlightDropIds = []
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const zoomGroupRef = useRef<SVGGElement>(null);
    const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
    const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
    const [focusedNode, setFocusedNode] = useState<GraphNode | null>(null);

    // Track previous data sizes to optimize simulation restarts
    const prevNodesLen = useRef(nodes.length);
    const prevLinksLen = useRef(links.length);

    // Support unified highlighting from either click (selectedNode prop) or internal focus
    const activeFocusNode = selectedNode || focusedNode;
    const focusId = activeFocusNode?.id;
    const focusExists = focusId ? nodes.some(n => n.id === focusId) : false;
    const effectiveFocused = focusExists ? activeFocusNode : null;

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
    const getNodeDimensions = (node: GraphNode, isTimeline: boolean, textOnly: boolean): { w: number, h: number, r: number, type: string } => {
        if (node.type === 'Person') {
            return { w: 48, h: 48, r: 55, type: 'circle' }; // r is collision radius
        }

        // Events/Things
        if (isTimeline) {
            // Timeline Card Mode: Fixed height for consistent layout
            return {
                w: 220,
                h: 220,
                r: 120, // Collision radius
                type: 'card'
            };
        } else {
            // Graph Mode
            // Square nodes for everything else, consistent with image nodes
            return { w: 60, h: 60, r: 60, type: 'box' };
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

    // Center on selected node when it changes
    useEffect(() => {
        if (!selectedNode || !svgRef.current || isTimelineMode) return;

        const svg = d3.select(svgRef.current);
        const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
            if (zoomGroupRef.current) {
                d3.select(zoomGroupRef.current).attr("transform", event.transform);
            }
        });

        // Get current transform
        const currentTransform = d3.zoomTransform(svgRef.current);
        const targetX = selectedNode.x ?? width / 2;
        const targetY = selectedNode.y ?? height / 2;

        // Calculate transition to center the node
        // We keep the current scale (k) but move to targetX, targetY
        const k = currentTransform.k;
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(k)
            .translate(-targetX, -targetY);

        svg.transition().duration(1000).call(zoom.transform, transform);
    }, [selectedNode?.id, width, height, isTimelineMode]);

    // Reset zoom and focused state when searchId changes (new graph)
    useEffect(() => {
        setFocusedNode(null);
        if (!svgRef.current) return;

        // Zoom Reset Logic
        if (searchId > 0) {
            const svg = d3.select(svgRef.current);
            const zoomIdentity = d3.zoomIdentity;
            // Re-create the zoom behavior to call transform on it
            const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
                if (zoomGroupRef.current) {
                    d3.select(zoomGroupRef.current).attr("transform", event.transform);
                }
            });

            svg.transition().duration(750).call(zoom.transform, zoomIdentity);
        }
    }, [searchId]);

    // Initialize simulation
    useEffect(() => {
        if (!svgRef.current) return;

        // Filter out and CLONE links to avoid D3 mutation issues and ensure fresh node lookups
        const validLinks = links
            .filter(link => {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                return nodes.some(n => n.id === sourceId) && nodes.some(n => n.id === targetId);
            })
            .map(link => ({
                ...link,
                source: typeof link.source === 'object' ? link.source.id : link.source,
                target: typeof link.target === 'object' ? link.target.id : link.target
            }));

        const simulation = d3.forceSimulation<GraphNode, GraphLink>(nodes)
            .force("link", d3.forceLink<GraphNode, GraphLink>(validLinks).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .velocityDecay(0.75); // Higher decay to bleed off shared angular momentum and prevent spinning

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
            .radius(d => {
                const dims = getNodeDimensions(d, isTimelineMode, isTextOnly);
                if (isCompact) {
                    // Tighter packing for compact mode, but prevent text overlap
                    // Increased padding from +8 to +16 to account for labels
                    if (dims.type === 'circle') return (dims.w / 2) + 16;
                    if (dims.type === 'box') return (dims.w / 2) + 16;
                    // Cards are large, keep standard collision but maybe tighter
                    return dims.r * 0.8;
                }
                return dims.r + 5;
            })
            .strength(0.8)
            .iterations(3);

        simulation.force("collidePeople", null);
        simulation.force("collideEvents", null);
        simulation.force("collide", collideForce);

        if (isTimelineMode) {
            const timelineNodes = nodes
                .filter(n => n.year !== undefined)
                .sort((a, b) => (Number(a.year ?? 0) - Number(b.year ?? 0)) || (a.id - b.id));

            const nodeIndexMap = new Map<number, number>(
                timelineNodes.map((n, i) => [n.id, i] as [number, number])
            );
            const itemSpacing = 240;
            const totalWidth = timelineNodes.length * itemSpacing;
            const startX = -(totalWidth / 2) + (itemSpacing / 2);

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
                    const offset = (index % 2 === 0) ? -120 : 120;
                    return (height / 2) + offset;
                }
                return height / 2;
            }).strength((d) => {
                if (nodeIndexMap.has(d.id)) return 1;
                return 0.01;
            }));

        } else {
            if (centerForce) centerForce.x(width / 2).y(height / 2).strength(1.0);

            // Standard vs Compact Settings
            // Reduced charge to prevent aggressive drifting
            const chargeStrength = isCompact ? -150 : -400;
            const linkDist = isCompact ? 60 : 120;

            if (chargeForce) chargeForce.strength(chargeStrength);
            if (linkForce) linkForce.strength(1).distance(linkDist);

            simulation.force("x", null);
            simulation.force("y", null);
        }

        simulation.alpha(0.5).restart();
    }, [isTimelineMode, isCompact, nodes, width, height, isTextOnly]);

    // 4. Structural Effect: Only runs when overall graph structure (nodes/links) changes.
    // This handles D3 enter/exit/merge and restarts the simulation.
    useEffect(() => {
        if (!simulationRef.current || !zoomGroupRef.current) return;
        const simulation = simulationRef.current;
        const container = d3.select(zoomGroupRef.current);

        // Filter out and CLONE links to avoid D3 mutation issues and ensure fresh node lookups.
        const validLinks = links
            .filter(link => {
                const sId = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source;
                const tId = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target;
                return nodes.some(n => n.id === sId) && nodes.some(n => n.id === tId);
            })
            .map(link => ({
                ...link,
                source: typeof link.source === 'object' ? (link.source as GraphNode).id : link.source,
                target: typeof link.target === 'object' ? (link.target as GraphNode).id : link.target
            }));

        const linkSel = container.selectAll<SVGPathElement, GraphLink>(".link").data(validLinks, d => d.id);
        linkSel.exit().remove();
        linkSel.enter().insert("path", ".node")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke", "#dc2626")
            .attr("stroke-opacity", 0.7)
            .attr("stroke-width", 3.5)
            .attr("stroke-linecap", "round");

        const nodeSel = container.selectAll<SVGGElement, GraphNode>(".node").data(nodes, d => d.id);
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
            .attr("id", d => `clip-circle-${String(d.id)}`)
            .append("circle").attr("cx", 0).attr("cy", 0);

        defs.append("clipPath")
            .attr("id", d => `clip-rect-${String(d.id)}`)
            .append("rect").attr("x", 0).attr("y", 0);

        nodeEnter.append("image").style("pointer-events", "none").attr("preserveAspectRatio", "xMidYMid slice");

        nodeEnter.append("text")
            .attr("class", "node-label")
            .attr("text-anchor", "middle")
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

        const spinner = nodeEnter.append("g").attr("class", "spinner-group").style("display", "none");
        spinner.append("circle")
            .attr("class", "spinner")
            .attr("fill", "none")
            .attr("stroke", "#a78bfa")
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

        nodeSel.exit().remove();

        // Always update simulation data to ensure D3 resolves string IDs into object references
        simulation.nodes(nodes);
        try {
            const linkForce = simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>;
            linkForce.links(validLinks);
        } catch (e) {
            console.error("D3 forceLink initialization failed:", e);
        }

        const hasStructureChanged = nodes.length !== prevNodesLen.current || validLinks.length !== prevLinksLen.current;
        if (hasStructureChanged) {
            simulation.alpha(0.3).restart();
        }

        prevNodesLen.current = nodes.length;
        prevLinksLen.current = validLinks.length;

        // Timeline axis setup
        let axisGroup = container.select<SVGGElement>(".timeline-axis");
        if (axisGroup.empty()) {
            axisGroup = container.insert("g", ":first-child").attr("class", "timeline-axis");
            axisGroup.append("line")
                .attr("stroke", "#64748b").attr("stroke-width", 1).attr("stroke-dasharray", "5,5");
        }

        simulation.on("tick", () => {
            container.selectAll<SVGPathElement, GraphLink>(".link").attr("d", d => {
                const source = d.source as GraphNode;
                const target = d.target as GraphNode;
                if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return null;
                const sx = source.x || 0, sy = source.y || 0, tx = target.x || 0, ty = target.y || 0;
                const dist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
                const midX = (sx + tx) / 2, midY = (sy + ty) / 2 + dist * 0.15;
                return `M${sx},${sy} Q${midX},${midY} ${tx},${ty}`;
            });

            container.selectAll<SVGGElement, GraphNode>(".node").attr("transform", d => `translate(${d.x},${d.y})`);

            if (isTimelineMode) {
                axisGroup.style("display", "block");
                axisGroup.select("line").attr("x1", -width * 4).attr("y1", height / 2).attr("x2", width * 4).attr("y2", height / 2);
            } else {
                axisGroup.style("display", "none");
            }
        });
    }, [nodes, links, isTimelineMode, width, height]);

    // 5. Stylistic Effect: Update colors, opacity, labels without restarting simulation
    useEffect(() => {
        if (!zoomGroupRef.current) return;
        const container = d3.select(zoomGroupRef.current);

        const keepHighlight = new Set(highlightKeepIds || []);
        const dropHighlight = new Set(highlightDropIds || []);
        const hasHighlight = keepHighlight.size > 0 || dropHighlight.size > 0;

        // Pre-calculate neighbor set for the focused node to make the loop more efficient and robust
        const neighborIds = new Set<number>();
        if (effectiveFocused) {
            links.forEach(l => {
                const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as number;
                const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as number;
                if (sId === effectiveFocused.id) neighborIds.add(tId);
                else if (tId === effectiveFocused.id) neighborIds.add(sId);
            });
        }

        const allNodes = container.selectAll<SVGGElement, GraphNode>(".node");
        const allLinks = container.selectAll<SVGPathElement, GraphLink>(".link");

        allNodes.each(function (d) {
            const g = d3.select(this);
            const dims = getNodeDimensions(d, isTimelineMode, isTextOnly);
            const isHovered = d.id === hoveredNode?.id;
            const isFocused = d.id === effectiveFocused?.id;
            let color = getNodeColor(d.type);
            const isDrop = dropHighlight.has(d.id);
            const isKeep = keepHighlight.has(d.id);

            let baseOpacity = 1;
            if (isDrop) {
                baseOpacity = 0.18;
            } else if (hasHighlight) {
                baseOpacity = isKeep ? 1 : 0.3;
            }

            if (effectiveFocused && !isFocused && !neighborIds.has(d.id)) {
                baseOpacity *= 0.25;
            }
            g.style("opacity", baseOpacity);

            const strokeColor = isDrop ? "#f87171" : (isKeep && hasHighlight ? "#22c55e" : (isHovered || isFocused ? "#f59e0b" : "#fff"));
            const strokeWidth = isDrop ? 3.5 : (isKeep && hasHighlight ? 2.5 : (isFocused ? 3 : 2));

            if (d.imageChecked && !d.imageUrl) color = '#64748b';

            g.select(".node-circle").style("display", "none");
            g.select(".node-rect").style("display", "none");
            g.select(".node-desc").style("display", "none");
            g.select(".spinner-group").style("display", "none");

            if (dims.type === 'circle') {
                const r = dims.w / 2;
                g.select(".node-circle").style("display", "block").attr("r", r).attr("fill", color).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
                g.select("image").style("display", (d.imageUrl && !isTextOnly) ? "block" : "none").attr("href", d.imageUrl || "").attr("x", -r).attr("y", -r).attr("width", r * 2).attr("height", r * 2)
                    .attr("clip-path", `url(#clip-circle-${String(d.id)})`);
                g.select(`#clip-circle-${String(d.id)}`).select("circle").attr("r", r);

                const labelText = g.select(".node-label").text(null).attr("y", r + 15);
                wrapText(d.title, 90).forEach((line, i) => labelText.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : "1.2em").style("font-size", "10px").text(line));
                g.select(".year-label").text(d.year || "").attr("y", -r - 10).style("display", (isTimelineMode || isHovered) && d.year ? "block" : "none");

            } else {
                const w = dims.w, h = dims.h;
                g.select(".node-rect").style("display", "block").attr("width", w).attr("height", h).attr("x", -w / 2).attr("y", -h / 2).attr("fill", color).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);

                if (dims.type === 'box' && d.imageUrl && !isTextOnly) {
                    g.select("image").style("display", "block").attr("href", d.imageUrl).attr("x", -w / 2).attr("y", -h / 2).attr("width", w).attr("height", h).attr("clip-path", `url(#clip-rect-${String(d.id)})`);
                    g.select(`#clip-rect-${String(d.id)}`).select("rect").attr("x", -w / 2).attr("y", -h / 2).attr("width", w).attr("height", h);
                } else {
                    g.select("image").style("display", "none");
                }

                let textY = (dims.type === 'card') ? 0 : (dims.type === 'box' ? 45 : 4);
                if (dims.type === 'card') {
                    const imgH = (d.imageUrl && !isTextOnly) ? h - 80 : 0;
                    const imgY = -h / 2;
                    textY = imgY + imgH + 15;
                    if (imgH > 0) {
                        g.select("image").style("display", "block").attr("href", d.imageUrl || "").attr("x", -w / 2).attr("y", imgY).attr("width", w).attr("height", imgH).attr("clip-path", `url(#clip-rect-${String(d.id)})`);
                        g.select(`#clip-rect-${String(d.id)}`).select("rect").attr("x", -w / 2).attr("y", imgY).attr("width", w).attr("height", imgH);
                    }
                    const descText = g.select(".node-desc").style("display", "block").attr("y", textY + 40);
                    descText.selectAll("tspan").remove();
                    wrapText(d.description || "", 190).forEach((line, i) => descText.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : "1.2em").style("font-size", "12px").text(line));
                }

                const labelText = g.select(".node-label").text(null).attr("y", textY);
                wrapText(d.title, dims.type === 'card' ? 200 : 100).forEach((line, i) => labelText.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : "1.2em").style("font-size", dims.type === 'card' ? "13px" : "10px").style("font-weight", dims.type === 'card' ? "bold" : "normal").text(line));
                g.select(".year-label").text(d.year || "").attr("y", -h / 2 - 10).style("display", (isTimelineMode || isHovered) && d.year ? "block" : "none");
            }
            g.select(".spinner-group").style("display", d.isLoading ? "block" : "none")
                .select(".spinner").attr("r", (dims.type === 'circle' || dims.type === 'box') ? (dims.w / 2) + 8 : (dims.h / 2) + 10);

            g.on("click", (event) => {
                if (event.defaultPrevented) return;
                event.stopPropagation();
                onNodeClick(d);
                setFocusedNode(null);
            })
                .on("mouseover", () => setHoveredNode(d))
                .on("mouseout", () => setHoveredNode(null));
        });

        // Background click to deselect
        d3.select(svgRef.current).on("click", (event) => {
            if (event.target === svgRef.current) {
                onNodeClick(null);
                setFocusedNode(null);
            }
        });

        allLinks
            .style("stroke-opacity", d => {
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source as string;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target as string;
                if (dropHighlight.has(sId) || dropHighlight.has(tId)) return 0.12;
                if (hasHighlight && (!keepHighlight.has(sId) || !keepHighlight.has(tId))) return 0.25;
                if (effectiveFocused) return (sId === effectiveFocused.id || tId === effectiveFocused.id) ? 0.9 : 0.1;
                return 0.7;
            })
            .style("stroke", d => {
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source as string;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target as string;
                if (dropHighlight.has(sId) || dropHighlight.has(tId)) return "#f87171";
                if (effectiveFocused && (sId === effectiveFocused.id || tId === effectiveFocused.id)) return "#f97316";
                return (hasHighlight && (!keepHighlight.has(sId) || !keepHighlight.has(tId))) ? "#94a3b8" : "#dc2626";
            });

    }, [nodes, links, isTimelineMode, hoveredNode, effectiveFocused, highlightKeepIds, highlightDropIds, isTextOnly, onNodeClick]);

    return (
        <svg
            ref={svgRef}
            width={width}
            height={height}
            className="cursor-move bg-slate-900"
            onClick={() => { setHoveredNode(null); setFocusedNode(null); }}
        >
            <g ref={zoomGroupRef} />
        </svg>
    );
};

export default Graph;
