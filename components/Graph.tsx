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
    highlightKeepIds?: string[];
    highlightDropIds?: string[];
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

    // Reset zoom when searchId changes
    useEffect(() => {
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

        // Only run this effect for searchId changes if we wanted separate reset logic,
        // but here we are mixing it with simulation init.
        // Actually, better to separate the zoom effect or handle it carefully.

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
                .sort((a, b) => (Number(a.year ?? 0) - Number(b.year ?? 0)) || a.id.localeCompare(b.id));

            const nodeIndexMap = new Map<string, number>(
                timelineNodes.map((n, i) => [n.id, i] as [string, number])
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

    // Update DOM & Styles
    useEffect(() => {
        if (!simulationRef.current || !zoomGroupRef.current) return;
        const simulation = simulationRef.current;
        const container = d3.select(zoomGroupRef.current);

        const keepHighlight = new Set(highlightKeepIds || []);
        const dropHighlight = new Set(highlightDropIds || []);
        const hasHighlight = keepHighlight.size > 0 || dropHighlight.size > 0;

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

        // Filter out and CLONE links to avoid D3 mutation issues and ensure fresh node lookups.
        // We convert back to string IDs to force D3 to re-resolve the objects.
        // This avoids stale object references from previous renders causing "drift".
        const validLinks = links
            .filter(link => {
                const sourceId = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source;
                const targetId = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target;
                return nodeMap.has(sourceId) && nodeMap.has(targetId);
            })
            .map(link => ({
                ...link,
                source: typeof link.source === 'object' ? (link.source as GraphNode).id : (link.source as string),
                target: typeof link.target === 'object' ? (link.target as GraphNode).id : (link.target as string)
            }));

        const linkSel = container.selectAll<SVGPathElement, GraphLink>(".link").data(validLinks, d => d.id);

        linkSel.exit().remove();

        const linkEnter = linkSel.enter().insert("path", ".node")
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

        const allNodes = nodeEnter.merge(nodeSel);

        allNodes.sort((a, b) => {
            const aIsPerson = a.type === 'Person';
            const bIsPerson = b.type === 'Person';
            if (aIsPerson && !bIsPerson) return 1;
            if (!aIsPerson && bIsPerson) return -1;
            return 0;
        });

        allNodes.each(function (d) {
            const g = d3.select(this);
            const dims = getNodeDimensions(d, isTimelineMode, isTextOnly);
            const isHovered = d.id === hoveredNode?.id;
            const isFocused = d.id === focusedNode?.id;
            let color = getNodeColor(d.type);
            const isDrop = dropHighlight.has(d.id);
            const isKeep = keepHighlight.has(d.id);
            let baseOpacity = 1;
            if (isDrop) {
                baseOpacity = 0.18; // strongly dim nodes that will be removed
            } else if (hasHighlight) {
                baseOpacity = isKeep ? 1 : 0.3; // dim non-kept nodes when previewing
            }
            // If a focus node exists, dim unrelated nodes
            if (focusedNode && !isFocused) {
                const isNeighbor = links.some(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
                    return (s === focusedNode.id && t === d.id) || (t === focusedNode.id && s === d.id);
                });
                if (!isNeighbor) baseOpacity *= 0.25;
            }
            g.style("opacity", baseOpacity);

            const strokeColor = isDrop ? "#f87171" : (isKeep && hasHighlight ? "#22c55e" : (isHovered ? "#f59e0b" : "#fff"));
            const strokeWidth = isDrop ? 3.5 : (isKeep && hasHighlight ? 2.5 : 2);

            // Grey out nodes with missing images
            if (d.imageChecked && !d.imageUrl) {
                color = '#64748b'; // Slate 500
            }

            g.select(".node-circle").style("display", "none");
            g.select(".node-rect").style("display", "none");
            g.select(".node-desc").style("display", "none");
            g.select(".spinner-group").style("display", "none");

            const showSpinner = d.isLoading;

            if (dims.type === 'circle') {
                const r = dims.w / 2;
                g.select(".node-circle")
                    .style("display", "block")
                    .attr("r", r)
                    .attr("fill", color)
                    .attr("stroke", strokeColor)
                    .attr("stroke-width", strokeWidth)
                    .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                g.select("image")
                    .style("display", (d.imageUrl && !isTextOnly) ? "block" : "none")
                    .attr("href", d.imageUrl || "")
                    .attr("x", -r).attr("y", -r)
                    .attr("width", r * 2).attr("height", r * 2)
                    .attr("clip-path", `url(#clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`)
                    .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                g.select(`#clip-circle-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("circle").attr("r", r);

                const labelLines = wrapText(d.id, 90);
                const labelText = g.select(".node-label");

                labelText
                    .text(null)
                    .attr("y", r + 15)
                    .attr("dy", 0)
                    .style("font-size", "10px")
                    .selectAll("tspan").remove();

                labelLines.forEach((line, i) => {
                    labelText.append("tspan")
                        .attr("x", 0)
                        .attr("dy", i === 0 ? 0 : "1.2em")
                        .text(line);
                });

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
                    .attr("x", -w / 2).attr("y", -h / 2)
                    .attr("fill", color)
                    .attr("stroke", strokeColor)
                    .attr("stroke-width", strokeWidth)
                    .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                if (dims.type === 'box' && d.imageUrl && !isTextOnly) {
                    g.select("image")
                        .style("display", "block")
                        .attr("href", d.imageUrl)
                        .attr("x", -w / 2).attr("y", -h / 2)
                        .attr("width", w).attr("height", h)
                        .attr("clip-path", `url(#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`)
                        .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                    g.select(`#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("rect")
                        .attr("x", -w / 2).attr("y", -h / 2)
                        .attr("width", w).attr("height", h)
                        .attr("rx", 0);
                } else {
                    g.select("image").style("display", "none");
                }

                let textY = 0;
                let descY = 0;
                let imgH = 120; // Default

                if (dims.type === 'card') {
                    const labelW = 200;
                    const labelLines = wrapText(d.id, labelW);
                    const descLines = wrapText(d.description || "", 190);

                    // Calculate text height
                    const titleH = labelLines.length * 15.6;
                    const descH = descLines.length > 0 ? descLines.length * 14.4 + 6 : 0;
                    const bottomPadding = 12;
                    const textAreaH = titleH + descH + bottomPadding + 15; // 15 for gap above title

                    imgH = (d.imageUrl && !isTextOnly) ? h - textAreaH : 0;

                    // Positions
                    const imgY = -h / 2;
                    textY = imgY + imgH + 15;
                    descY = textY + titleH + 6;

                    // Update Image and ClipPath with calculated imgH
                    if (imgH > 0) {
                        g.select("image")
                            .style("display", "block")
                            .attr("href", d.imageUrl || "")
                            .attr("x", -w / 2).attr("y", imgY)
                            .attr("width", w).attr("height", imgH)
                            .attr("clip-path", `url(#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')})`)
                            .style("opacity", (d.fetchingImage) ? 0.7 : 1);

                        g.select(`#clip-rect-${d.id.replace(/[^a-zA-Z0-9-]/g, '-')}`).select("rect")
                            .attr("x", -w / 2).attr("y", imgY)
                            .attr("width", w).attr("height", imgH)
                            .attr("rx", 0);
                    } else {
                        g.select("image").style("display", "none");
                    }

                    g.select(".node-desc")
                        .style("display", descLines.length > 0 ? "block" : "none")
                        .style("font-size", "12px")
                        .style("font-weight", "500")
                        .attr("y", descY)
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

                const labelW = dims.type === 'card' ? 200 : 100;
                const labelLines = wrapText(d.id, labelW);
                const labelText = g.select(".node-label");

                labelText
                    .text(null)
                    .attr("y", textY)
                    .attr("dy", 0)
                    .style("font-size", dims.type === 'card' ? "13px" : "10px")
                    .style("font-weight", dims.type === 'card' ? "bold" : "normal")
                    .selectAll("tspan").remove();

                labelLines.forEach((line, i) => {
                    labelText.append("tspan")
                        .attr("x", 0)
                        .attr("dy", i === 0 ? 0 : "1.2em")
                        .text(line);
                });

                g.select(".year-label")
                    .text(d.year || "")
                    .attr("y", -h / 2 - 10)
                    .style("display", (isTimelineMode || isHovered) && d.year ? "block" : "none");
            }

            const spinnerR = (dims.type === 'circle' || dims.type === 'box') ? (dims.w / 2) + 8 : (dims.h / 2) + 10;
            g.select(".spinner-group")
                .style("display", showSpinner ? "block" : "none")
                .select(".spinner").attr("r", spinnerR);
        });

        allNodes
            .on("click", (event, d) => {
                if (event.defaultPrevented) return;
                event.stopPropagation();
                onNodeClick(d);
                setFocusedNode(prev => (prev && prev.id === d.id) ? null : d);
            })
            .on("mouseover", (e, d) => setHoveredNode(d))
            .on("mouseout", () => setHoveredNode(null));

        simulation.nodes(nodes);
        try {
            const linkForce = simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>;
            linkForce.links(validLinks);
        } catch (e) {
            console.error("D3 forceLink initialization failed:", e);
        }

        const hasStructureChanged = nodes.length !== prevNodesLen.current || validLinks.length !== prevLinksLen.current;
        if (hasStructureChanged) {
            // Reset velocities so new expansions don't inherit shared spin
            simulation.nodes().forEach(n => {
                n.vx = 0;
                n.vy = 0;
            });
            // "Warm" restart instead of hot to prevent explosion
            simulation.alpha(0.25).restart();
        } else {
            simulation.alphaTarget(0); 
        }

        prevNodesLen.current = nodes.length;
        prevLinksLen.current = validLinks.length;

        let axisGroup = container.select<SVGGElement>(".timeline-axis");
        if (axisGroup.empty()) {
            axisGroup = container.insert("g", ":first-child").attr("class", "timeline-axis");
            axisGroup.append("line")
                .attr("stroke", "#64748b").attr("stroke-width", 1).attr("stroke-dasharray", "5,5");
        }

        const allLinks = container.selectAll<SVGPathElement, GraphLink>(".link");

        const computeLinkOpacity = (d: GraphLink) => {
            const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source as string;
            const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target as string;
            if (dropHighlight.has(sId) || dropHighlight.has(tId)) return 0.12;
            if (hasHighlight && (!keepHighlight.has(sId) || !keepHighlight.has(tId))) return 0.25;
            if (focusedNode) {
                const isNeighbor = sId === focusedNode.id || tId === focusedNode.id;
                return isNeighbor ? 0.9 : 0.1;
            }
            return 0.7;
        };

        allLinks
            .style("stroke-opacity", computeLinkOpacity)
            .style("stroke", d => {
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source as string;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target as string;
                if (dropHighlight.has(sId) || dropHighlight.has(tId)) return "#f87171";
                if (hasHighlight && (!keepHighlight.has(sId) || !keepHighlight.has(tId))) return "#94a3b8";
                if (focusedNode) {
                    const isNeighbor = sId === focusedNode.id || tId === focusedNode.id;
                    return isNeighbor ? "#f97316" : "#475569";
                }
                return "#dc2626";
            });

        simulation.on("tick", () => {
            allLinks.attr("d", d => {
                if (!d.source || !d.target) return "";
                const source = d.source as GraphNode;
                const target = d.target as GraphNode;

                if (typeof source === 'string' || typeof target === 'string') return "";

                const sx = source.x;
                const sy = source.y;
                const tx = target.x;
                const ty = target.y;

                if (sx === undefined || sy === undefined || tx === undefined || ty === undefined ||
                    isNaN(sx) || isNaN(sy) || isNaN(tx) || isNaN(ty)) return "";

                const dx = tx - sx;
                const dy = ty - sy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                const sag = dist * 0.15;

                const midX = (sx + tx) / 2;
                const midY = (sy + ty) / 2 + sag;

                return `M${sx},${sy} Q${midX},${midY} ${tx},${ty}`;
            });

            allNodes.attr("transform", d => `translate(${d.x},${d.y})`);

            if (isTimelineMode) {
                const years = nodes.map(n => n.year).filter((y): y is number => y !== undefined);
                if (years.length > 0) {
                    axisGroup.style("display", "block");
                    axisGroup.select("line")
                        .attr("x1", -width * 4).attr("y1", height / 2)
                        .attr("x2", width * 4).attr("y2", height / 2);
                }
            } else {
                axisGroup.style("display", "none");
            }
        });

    }, [nodes, links, isTimelineMode, width, height, hoveredNode, onNodeClick, isTextOnly, highlightKeepIds, highlightDropIds]);

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
