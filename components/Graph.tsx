import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
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

export interface GraphHandle {
    centerOnNode: (nodeId: number) => void;
}

const DEFAULT_CARD_SIZE = 220;

const Graph = forwardRef<GraphHandle, GraphProps>(({
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
}, ref) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const zoomGroupRef = useRef<SVGGElement>(null);
    const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
    const [focusedNode, setFocusedNode] = useState<GraphNode | null>(null);
    const [timelineLayoutVersion, setTimelineLayoutVersion] = useState(0);
    const wasTimelineRef = useRef(isTimelineMode);
    const timelinePositionsRef = useRef(new Map<number, { x: number, y: number }>());

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

    function getNodeColor(type: string, isPerson?: boolean) {
        if (type === 'Origin') return '#ef4444';
        if (isPerson ?? type.toLowerCase() === 'person') return '#f59e0b';
        return '#3b82f6';
    }

    function escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Calculate dynamic dimensions for nodes
    const getNodeDimensions = (node: GraphNode, isTimeline: boolean, textOnly: boolean): { w: number, h: number, r: number, type: string } => {
        const isPersonNode = node.is_person ?? node.type.toLowerCase() === 'person';
        if (isPersonNode) {
            if (isTimeline) {
                // Larger size in timeline mode (2x)
                return { w: 96, h: 96, r: 110, type: 'circle' }; // r is collision radius
            } else {
                // Smaller size in graph mode (original size)
                return { w: 48, h: 48, r: 55, type: 'circle' }; // r is collision radius
            }
        }

        // Events/Things
        if (isTimeline) {
            // Timeline Card Mode: Fixed height for consistent layout
            return {
                w: DEFAULT_CARD_SIZE,
                h: DEFAULT_CARD_SIZE,
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
    const wrapText = (text: string, width: number, maxLines?: number) => {
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
                if (maxLines && lines.length >= maxLines) break;
            }
        }
        if (currentLine) lines.push(currentLine);
        return maxLines ? lines.slice(0, maxLines) : lines;
    };

    // Expose centerOnNode function via ref
    useImperativeHandle(ref, () => ({
        centerOnNode: (nodeId: number) => {
            const node = nodes.find(n => n.id === nodeId);
            if (!node || !svgRef.current || isTimelineMode) return;

            const svg = d3.select(svgRef.current);
            const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
                if (zoomGroupRef.current) {
                    d3.select(zoomGroupRef.current).attr("transform", event.transform);
                }
            });

            // Get current transform
            const currentTransform = d3.zoomTransform(svgRef.current);
            const targetX = node.x ?? width / 2;
            const targetY = node.y ?? height / 2;

            // Keep current scale, pan to center the node
            const k = currentTransform.k;
            const transform = d3.zoomIdentity
                .translate(width / 2, height / 2)
                .scale(k)
                .translate(-targetX, -targetY);

            svg.transition().duration(500).call(zoom.transform, transform);
        }
    }), [nodes, width, height, isTimelineMode]);

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
            .velocityDecay(0.85); // Higher decay to prevent spinning (increased from 0.75)

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

        zoomBehaviorRef.current = zoom;
        d3.select(svgRef.current).call(zoom).on("dblclick.zoom", null);

        return () => {
            simulation.stop();
            d3.select(svgRef.current).on(".zoom", null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height]);

    // Keyboard navigation with arrow keys
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Only handle arrow keys
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                return;
            }

            // Don't navigate if user is typing in an input field
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            if (!svgRef.current || !zoomBehaviorRef.current) return;

            event.preventDefault();

            const svg = d3.select(svgRef.current);
            const currentTransform = d3.zoomTransform(svgRef.current);
            
            // Pan distance (adjustable)
            const panDistance = 50;
            
            let newX = currentTransform.x;
            let newY = currentTransform.y;

            switch (event.key) {
                case 'ArrowUp':
                    newY += panDistance;
                    break;
                case 'ArrowDown':
                    newY -= panDistance;
                    break;
                case 'ArrowLeft':
                    newX += panDistance;
                    break;
                case 'ArrowRight':
                    newX -= panDistance;
                    break;
            }

            // Create new transform with updated translation
            const newTransform = d3.zoomIdentity
                .translate(newX, newY)
                .scale(currentTransform.k);

            // Apply transform with smooth transition
            svg.transition()
                .duration(200)
                .ease(d3.easeLinear)
                .call(zoomBehaviorRef.current.transform, newTransform);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

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
                // Use actual measured height for cards (d.h) if available, otherwise use dims
                if (isTimelineMode && dims.type === 'card') {
                    // For timeline cards, use the larger of width or height plus padding
                    const cardWidth = dims.w;
                    const cardHeight = d.h || dims.h;
                    // Use the diagonal distance plus padding to ensure no overlap
                    const maxDimension = Math.max(cardWidth, cardHeight);
                    return (maxDimension / 2) + 15; // Increased padding to prevent overlap
                }
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
            .strength(isTimelineMode ? 0.5 : 0.8) // Lower collision for timeline since events are fixed
            .iterations(isTimelineMode ? 3 : 3);

        simulation.force("collidePeople", null);
        simulation.force("collideEvents", null);
        simulation.force("collide", collideForce);

        if (isTimelineMode) {
            const lockNodePosition = (node: GraphNode, x: number, y: number) => {
                node.fx = x;
                node.fy = y;
                node.x = x;
                node.y = y;
                node.vx = 0;
                node.vy = 0;
                timelinePositionsRef.current.set(node.id, { x, y });
            };

            timelinePositionsRef.current.clear();

            // Sort timeline nodes by year (ensure numeric comparison), then by id for stability
            const timelineNodes = nodes
                .filter(n => n.year !== undefined)
                .sort((a, b) => {
                    const yearA = Number(a.year ?? 0);
                    const yearB = Number(b.year ?? 0);
                    if (yearA !== yearB) return yearA - yearB;
                    return a.id - b.id;
                });

            const nodeIndexMap = new Map<number, number>(
                timelineNodes.map((n, i) => [n.id, i] as [number, number])
            );
            // Increased spacing to account for card width (220px) plus padding
            const itemSpacing = 260;
            const totalWidth = timelineNodes.length * itemSpacing;
            const startX = -(totalWidth / 2) + (itemSpacing / 2);
            const centerY = height / 2;
            const yOffset = 120;

            // Reset all fixed positions first
            nodes.forEach(node => {
                node.fx = null;
                node.fy = null;
            });

            // Fix event positions - they don't move
            timelineNodes.forEach((node, index) => {
                const fixedX = width / 2 + startX + (index * itemSpacing);
                const fixedY = centerY + ((index % 2 === 0) ? -yOffset : yOffset);
                lockNodePosition(node, fixedX, fixedY);
            });

            // Position people in multiple horizontal lines above events (wrap to match event width)
            const peopleNodes = nodes.filter(n => n.is_person ?? n.type.toLowerCase() === 'person');
            
            if (timelineNodes.length > 0) {
                const personRadius = 110; // Match Person collision radius for timeline (2x size)
                const minPersonDistance = personRadius * 2 + 20; // Spacing between people
                // Place lines above the highest events (top events are at centerY - yOffset)
                const cardHeightGuess = timelineNodes.reduce((max, event) => {
                    const h = event.h && event.h > 0 ? event.h : DEFAULT_CARD_SIZE;
                    return Math.max(max, h);
                }, DEFAULT_CARD_SIZE);
                const basePersonLineY = centerY - yOffset - (cardHeightGuess / 2) - personRadius - 30;

                // Compute available width - use the full event span
                const eventSpan = Math.max(itemSpacing, (timelineNodes.length - 1) * itemSpacing + DEFAULT_CARD_SIZE);
                const availableWidth = Math.min(eventSpan * 1.1, width * 0.95); // Use most of available width

                // Compute desired X based on connected events; fall back to center
                const desiredPositions = peopleNodes.map(person => {
                    const connectedEvents = links
                        .filter(l => {
                            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                            return (sId === person.id || tId === person.id);
                        })
                        .map(l => {
                            const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                            const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                            const eventId = sId === person.id ? tId : sId;
                            return nodes.find(n => n.id === eventId && n.year !== undefined);
                        })
                        .filter((e): e is GraphNode => e !== undefined);

                    if (connectedEvents.length > 0) {
                        const sumX = connectedEvents.reduce((sum, event) => {
                            const index = nodeIndexMap.get(event.id) ?? 0;
                            return sum + (width / 2 + startX + (index * itemSpacing));
                        }, 0);
                        return { person, desiredX: sumX / connectedEvents.length };
                    }
                    return { person, desiredX: width / 2 };
                });

                // Sort by desired X to place left-to-right
                desiredPositions.sort((a, b) => a.desiredX - b.desiredX);

                // Always try to fit all people in one row, spacing them out evenly
                // Calculate spacing: if they don't fit with minPersonDistance, reduce spacing slightly
                const totalWidthNeeded = desiredPositions.length * minPersonDistance;
                let actualSpacing = minPersonDistance;
                if (totalWidthNeeded > availableWidth && desiredPositions.length > 1) {
                    // Reduce spacing to fit, but keep at least personRadius * 1.8 to avoid overlap
                    actualSpacing = Math.max(personRadius * 1.8, availableWidth / desiredPositions.length);
                }

                const totalRowWidth = actualSpacing * (desiredPositions.length - 1);
                const rowStartX = width / 2 - (totalRowWidth / 2);
                
                // Place all people in a single row
                desiredPositions.forEach((entry, index) => {
                    const { person } = entry;
                    const x = rowStartX + actualSpacing * index;
                    lockNodePosition(person, x, basePersonLineY);
                });
            }

            if (centerForce) centerForce.strength(0.01);
            if (chargeForce) chargeForce.strength(-50); // Reduced charge to minimize movement
            if (linkForce) linkForce.strength(0);

            // Events and people have fixed positions (fx, fy already set above)
            // No need for positioning forces since everything is fixed
            simulation.force("x", null);
            simulation.force("y", null);
            
            // Increase velocity decay to stop all movement quickly
            simulation.velocityDecay(0.9);

        } else {
            timelinePositionsRef.current.clear();
            // Reset fixed positions for non-timeline mode
            nodes.forEach(node => {
                node.fx = null;
                node.fy = null;
            });

            if (centerForce) centerForce.x(width / 2).y(height / 2).strength(1.0);

            // Standard vs Compact Settings
            // Reduced charge to prevent aggressive drifting
            const chargeStrength = isCompact ? -150 : -400;
            const linkDist = isCompact ? 60 : 120;

            if (chargeForce) chargeForce.strength(chargeStrength);
            if (linkForce) linkForce.strength(1).distance(linkDist);

            simulation.force("x", null);
            simulation.force("y", null);
            
            // Higher velocity decay for non-timeline mode to prevent spinning
            simulation.velocityDecay(0.85);
        }

        simulation.alpha(isTimelineMode ? 0.2 : 0.3).restart(); // Reduced from 0.5 to 0.3 to prevent spinning
    }, [isTimelineMode, isCompact, nodes, links, width, height, isTextOnly, timelineLayoutVersion]);

    // Hard-clamp positions every frame in timeline mode to prevent drifting
    useEffect(() => {
        if (!isTimelineMode || !zoomGroupRef.current) return;
        const container = d3.select(zoomGroupRef.current);

        const getCoords = (node: GraphNode) => {
            const fixed = timelinePositionsRef.current.get(node.id);
            const x = (fixed?.x ?? node.fx ?? node.x) || 0;
            const y = (fixed?.y ?? node.fy ?? node.y) || 0;
            return { x, y };
        };

        const render = () => {
            container.selectAll<SVGPathElement, GraphLink>(".link").attr("d", d => {
                const source = d.source as GraphNode;
                const target = d.target as GraphNode;
                if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return null;
                const s = getCoords(source);
                const t = getCoords(target);
                const dist = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2);
                const midX = (s.x + t.x) / 2;
                const midY = (s.y + t.y) / 2 + dist * 0.15;
                return `M${s.x},${s.y} Q${midX},${midY} ${t.x},${t.y}`;
            });

            container.selectAll<SVGGElement, GraphNode>(".node").attr("transform", d => {
                const { x, y } = getCoords(d);
                d.x = x;
                d.y = y;
                d.vx = 0;
                d.vy = 0;
                return `translate(${x},${y})`;
            });
        };

        let frame = requestAnimationFrame(function loop() {
            render();
            frame = requestAnimationFrame(loop);
        });

        return () => cancelAnimationFrame(frame);
    }, [isTimelineMode, nodes, links]);

    // Reset zoom and re-center positions when leaving timeline mode to avoid off-screen jumps
    useEffect(() => {
        const wasTimeline = wasTimelineRef.current;
        if (wasTimeline && !isTimelineMode) {
            // Reset node positions near center with a small jitter to let simulation settle quickly
            nodes.forEach(node => {
                node.fx = null;
                node.fy = null;
                node.x = width / 2 + (Math.random() - 0.5) * 80;
                node.y = height / 2 + (Math.random() - 0.5) * 80;
            });

            if (simulationRef.current) {
                simulationRef.current.alpha(0.8).restart();
            }

            if (svgRef.current && zoomBehaviorRef.current) {
                const svg = d3.select(svgRef.current);
                svg.transition().duration(500).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
            }
        }
        wasTimelineRef.current = isTimelineMode;
    }, [isTimelineMode, nodes, width, height]);

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
        const linkEnter = linkSel.enter().insert("path", ".node")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke", "#dc2626")
            .attr("stroke-opacity", 0.7)
            .attr("stroke-width", 3.5)
            .attr("stroke-linecap", "round");
        
        // In timeline mode, links are hidden by default, shown only when person is selected
        const linkMerged = linkSel.merge(linkEnter);
        if (isTimelineMode) {
            linkMerged.style("display", "none");
        } else {
            linkMerged.style("display", null);
        }

        const nodeSel = container.selectAll<SVGGElement, GraphNode>(".node").data(nodes, d => d.id);
        const nodeEnter = nodeSel.enter().append("g")
            .attr("class", "node");
        
        // Create drag behavior - only allow dragging if not in timeline mode, or if not a person node in timeline mode
        const dragBehavior = d3.drag<SVGGElement, GraphNode>()
            .on("start", (event, d) => {
                if (isTimelineMode) {
                    const isPerson = (d.is_person ?? d.type.toLowerCase()) === 'person';
                    if (isPerson) {
                        event.sourceEvent.stopPropagation();
                        return; // Don't allow dragging people in timeline mode
                    }
                }
                dragstarted(event, d);
            })
            .on("drag", (event, d) => {
                if (isTimelineMode) {
                    const isPerson = (d.is_person ?? d.type.toLowerCase()) === 'person';
                    if (isPerson) return; // Don't allow dragging people in timeline mode
                }
                dragged(event, d);
            })
            .on("end", (event, d) => {
                if (isTimelineMode) {
                    const isPerson = (d.is_person ?? d.type.toLowerCase()) === 'person';
                    if (isPerson) return; // Don't allow dragging people in timeline mode
                }
                dragended(event, d);
            });
        
        // Apply drag to all nodes (both new and existing)
        // nodeSel includes all nodes, so we call drag on the merged selection
        nodeEnter.merge(nodeSel).call(dragBehavior);

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

        defs.append("clipPath")
            .attr("id", d => `clip-desc-${String(d.id)}`)
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

        nodeEnter.append("text")
            .attr("class", "people-label")
            .attr("text-anchor", "middle")
            .style("font-size", "11px")
            .style("font-family", "sans-serif")
            .style("pointer-events", "none")
            .attr("fill", "#f59e0b")
            .style("font-style", "italic");

        // Add foreignObject for card content in timeline mode (uses HTML for automatic text sizing)
        nodeEnter.append("foreignObject")
            .attr("class", "card-content")
            .style("overflow", "visible")
            .style("pointer-events", "none");

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
            // Use lower alpha to prevent jarring movements when nodes are added during expansion
            // Only restart if simulation is not already active (alpha > 0.01)
            const currentAlpha = simulation.alpha();
            if (currentAlpha < 0.01) {
                simulation.alpha(0.1).restart(); // Lower alpha to reduce spinning (reduced from 0.15)
            } else {
                // Just increase alpha slightly if already running, don't fully restart
                simulation.alpha(Math.min(currentAlpha + 0.03, 0.3)); // Reduced max alpha from 0.5 to 0.3
            }
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
            const linkPath = (d: GraphLink) => {
                const source = d.source as GraphNode;
                const target = d.target as GraphNode;
                if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return null;
                const fixedS = timelinePositionsRef.current.get(source.id);
                const fixedT = timelinePositionsRef.current.get(target.id);
                const sx = (fixedS?.x ?? source.fx ?? source.x) || 0;
                const sy = (fixedS?.y ?? source.fy ?? source.y) || 0;
                const tx = (fixedT?.x ?? target.fx ?? target.x) || 0;
                const ty = (fixedT?.y ?? target.fy ?? target.y) || 0;
                const dist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
                const midX = (sx + tx) / 2, midY = (sy + ty) / 2 + dist * 0.15;
                return `M${sx},${sy} Q${midX},${midY} ${tx},${ty}`;
            };

            container.selectAll<SVGPathElement, GraphLink>(".link").attr("d", linkPath);

            container.selectAll<SVGGElement, GraphNode>(".node").attr("transform", d => {
                const fixed = timelinePositionsRef.current.get(d.id);
                const x = (fixed?.x ?? d.fx ?? d.x) || 0;
                const y = (fixed?.y ?? d.fy ?? d.y) || 0;
                return `translate(${x},${y})`;
            });

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

        // Build set of path links (links between consecutive nodes in the path)
        // IMPORTANT: Only highlight links that actually exist and are part of the path sequence
        const pathLinkIds = new Set<string>();
        if (hasHighlight && highlightKeepIds && highlightKeepIds.length > 1) {
            // For each consecutive pair in the path, check if a link exists
            for (let i = 0; i < highlightKeepIds.length - 1; i++) {
                const nodeId1 = highlightKeepIds[i];
                const nodeId2 = highlightKeepIds[i + 1];
                // Find the actual link ID in the links array
                const link = links.find(l => {
                    const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                    const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                    return (sId === nodeId1 && tId === nodeId2) || (sId === nodeId2 && tId === nodeId1);
                });
                if (link) {
                    pathLinkIds.add(link.id);
                    console.log(`Path link found: ${nodeId1} <-> ${nodeId2} (link ID: ${link.id})`);
                } else {
                    console.log(`Path link NOT found: ${nodeId1} <-> ${nodeId2} - will not highlight`);
                }
            }
            console.log(`Path link IDs to highlight:`, Array.from(pathLinkIds));
        }

        // Pre-calculate neighbor set for the focused node to make the loop more efficient and robust
        const neighborIds = new Set<string | number>();
        if (effectiveFocused) {
            links.forEach(l => {
                const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                if (sId === effectiveFocused.id) neighborIds.add(tId);
                else if (tId === effectiveFocused.id) neighborIds.add(sId);
            });
        }

        const allNodes = container.selectAll<SVGGElement, GraphNode>(".node");
        const allLinks = container.selectAll<SVGPathElement, GraphLink>(".link");

        // Build map of event to connected people for timeline mode
        const eventToPeople = new Map<number, string[]>();
        if (isTimelineMode) {
            links.forEach(l => {
                const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                
                const sourceNode = nodes.find(n => n.id === sId);
                const targetNode = nodes.find(n => n.id === tId);
                
                // If one is an event (has year) and one is a person (no year), add person to event
                if (sourceNode && targetNode) {
                    if (sourceNode.year !== undefined && targetNode.year === undefined) {
                        const people = eventToPeople.get(sourceNode.id) || [];
                        if (!people.includes(targetNode.title)) {
                            people.push(targetNode.title);
                            eventToPeople.set(sourceNode.id, people);
                        }
                    } else if (targetNode.year !== undefined && sourceNode.year === undefined) {
                        const people = eventToPeople.get(targetNode.id) || [];
                        if (!people.includes(sourceNode.title)) {
                            people.push(sourceNode.title);
                            eventToPeople.set(targetNode.id, people);
                        }
                    }
                }
            });
        }

        allNodes.each(function (d) {
            const g = d3.select(this);
            
            // Show all nodes (people are now visible in timeline mode)
            g.style("display", null);
            
            const dims = getNodeDimensions(d, isTimelineMode, isTextOnly);
            const isHovered = d.id === hoveredNode?.id;
            const isFocused = d.id === effectiveFocused?.id;
            let color = getNodeColor(d.type, d.is_person);
            const isDrop = dropHighlight.has(d.id);
            const isKeep = keepHighlight.has(d.id);

            let baseOpacity = 1;
            if (isDrop) {
                baseOpacity = 0.18;
            } else if (hasHighlight) {
                baseOpacity = isKeep ? 1 : 0.3;
            }

            // Don't dim nodes that are in the path (keepHighlight) even if they're not focused
            if (effectiveFocused && !isFocused && !neighborIds.has(d.id) && !isKeep) {
                baseOpacity *= 0.25;
            }
            g.style("opacity", baseOpacity);

            const strokeColor = isDrop ? "#f87171" : (isKeep && hasHighlight ? "#22c55e" : (isHovered || isFocused ? "#f59e0b" : "#fff"));
            const strokeWidth = isDrop ? 3.5 : (isKeep && hasHighlight ? 2.5 : (isFocused ? 3 : 2));

            if (d.imageChecked && !d.imageUrl) color = '#64748b';

            g.select(".node-circle").style("display", "none");
            g.select(".node-rect").style("display", "none");
            g.select(".node-desc").style("display", "none").attr("clip-path", null);
            g.select(".people-label").style("display", "none").attr("clip-path", null);
            g.select(".spinner-group").style("display", "none");

            if (dims.type === 'circle') {
                // Hide card-content for circle nodes
                g.select(".card-content").style("display", "none");
                const r = dims.w / 2;
                g.select(".node-circle").style("display", "block").attr("r", r).attr("fill", color).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);
                g.select("image").style("display", (d.imageUrl && !isTextOnly) ? "block" : "none").attr("href", d.imageUrl || "").attr("x", -r).attr("y", -r).attr("width", r * 2).attr("height", r * 2)
                    .attr("clip-path", `url(#clip-circle-${String(d.id)})`);
                g.select(`#clip-circle-${String(d.id)}`).select("circle").attr("r", r);

                const labelText = g.select(".node-label").style("display", "block").text(null).attr("y", r + 15);
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
                    const cardWidth = w;
                    const padding = 15;
                    const imgH = (d.imageUrl && !isTextOnly) ? 140 : 0;
                    const imgSpacing = imgH > 0 ? 12 : 0;
                    
                    // Check if we need space for people names in timeline mode
                    const connectedPeople = isTimelineMode ? (eventToPeople.get(d.id) || []) : [];
                    const hasPeople = connectedPeople.length > 0;
                    const peopleText = hasPeople ? connectedPeople.join(", ") : "";
                    const contentWidth = cardWidth - padding * 2;
                    
                    // Truncate description to first sentence
                    let displayDescription = "";
                    if (d.description) {
                        // Find first sentence ending (period, exclamation, question mark followed by space or end)
                        const sentenceMatch = d.description.match(/^[^.!?]*[.!?](?:\s|$)/);
                        if (sentenceMatch) {
                            displayDescription = sentenceMatch[0].trim();
                        } else {
                            // If no sentence ending found, take first 150 characters
                            displayDescription = d.description.substring(0, 150).trim();
                        }
                    }
                    
                    // Create HTML content with everything (image and text) - browser will size it naturally
                    // Text is white (#ffffff) which will be visible on the blue card background from .node-rect
                    const htmlContent = `
                        <div xmlns="http://www.w3.org/1999/xhtml" style="
                            width: ${contentWidth}px;
                            padding: ${padding}px;
                            box-sizing: border-box;
                            color: #ffffff;
                            font-family: sans-serif;
                            background: transparent;
                        ">
                            ${imgH > 0 ? `<img src="${d.imageUrl}" style="width: 100%; height: ${imgH}px; object-fit: contain; display: block; margin-bottom: ${imgSpacing}px;" />` : ''}
                            <div style="font-size: 13px; font-weight: bold; margin-bottom: 12px; line-height: 1.4; word-wrap: break-word; color: #ffffff;">${escapeHtml(d.title)}</div>
                            ${displayDescription ? `<div style="font-size: 12px; margin-bottom: 12px; line-height: 1.4; word-wrap: break-word; color: #ffffff;">${escapeHtml(displayDescription)}</div>` : ''}
                            ${hasPeople ? `<div style="font-size: 11px; color: #e2e8f0; font-style: italic; line-height: 1.4; word-wrap: break-word;">${escapeHtml(peopleText)}</div>` : ''}
                        </div>
                    `;
                    
                    // Use foreignObject for automatic HTML layout and sizing
                    const cardContent = g.select(".card-content");
                    
                    // Set initial size (will be measured and adjusted)
                    const initialHeight = 200;
                    cardContent
                        .style("display", "block")
                        .attr("x", -cardWidth / 2)
                        .attr("y", -initialHeight / 2)
                        .attr("width", cardWidth)
                        .attr("height", initialHeight * 2)
                        .html(htmlContent);
                    
                    // Hide SVG image and text elements (using HTML instead)
                    g.select("image").style("display", "none");
                    g.select(".node-label").style("display", "none");
                    g.select(".node-desc").style("display", "none");
                    g.select(".people-label").style("display", "none");
                    
                    // Set initial card size (will be refined after measurement)
                    g.select(".node-rect")
                        .attr("width", cardWidth)
                        .attr("height", initialHeight)
                        .attr("x", -cardWidth / 2)
                        .attr("y", -initialHeight / 2);
                    
                    // Update year label - always show in timeline mode if year exists
                    const yearLabel = g.select(".year-label");
                    yearLabel.text(d.year || "");
                    yearLabel.attr("y", -initialHeight / 2 - 10);
                    yearLabel.style("display", (isTimelineMode && d.year) ? "block" : ((isHovered && d.year) ? "block" : "none"));
                    
                    // Set initial height for collision (will be updated after measurement)
                    d.h = initialHeight;
                } else {
                    // Hide card-content for non-card nodes
                    g.select(".card-content").style("display", "none");
                    g.select(".people-label").style("display", "none");
                    // Show and update node-label for box mode
                    const labelText = g.select(".node-label").style("display", "block").text(null).attr("y", textY);
                    wrapText(d.title, dims.type === 'box' ? 100 : 200).forEach((line, i) => labelText.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : "1.2em").style("font-size", dims.type === 'card' ? "13px" : "10px").style("font-weight", dims.type === 'card' ? "bold" : "normal").text(line));
                }

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
        
        // Batch measure all card heights after browser renders (using requestAnimationFrame)
        if (isTimelineMode) {
            requestAnimationFrame(() => {
                let hasChanges = false;
                allNodes.each(function(d) {
                    const isPersonNode = d.is_person ?? d.type.toLowerCase() === 'person';
                    if (isPersonNode) return; // Skip people nodes
                    const g = d3.select(this);
                    const cardContent = g.select(".card-content");
                    if (cardContent.empty()) return;
                    
                    const foreignObj = cardContent.node() as SVGForeignObjectElement | null;
                    if (foreignObj && foreignObj.firstElementChild) {
                        const div = foreignObj.firstElementChild as HTMLElement;
                        const actualHeight = div.offsetHeight || div.scrollHeight;
                        const cardHeight = actualHeight;
                        const cardWidth = DEFAULT_CARD_SIZE; // Fixed width from getNodeDimensions
                        
                        // Only update if height changed
                        if (d.h !== cardHeight) {
                            hasChanges = true;
                            
                            // Update foreignObject position to center vertically
                            cardContent.attr("y", -cardHeight / 2);
                            
                            // Update card rectangle
                            g.select(".node-rect")
                                .attr("width", cardWidth)
                                .attr("height", cardHeight)
                                .attr("x", -cardWidth / 2)
                                .attr("y", -cardHeight / 2);
                            
                            // Update node dimensions for collision detection
                            d.h = cardHeight;
                        }
                        
                        // Always update year label position and ensure it's visible in timeline mode
                        const yearLabel = g.select(".year-label");
                        yearLabel.text(d.year || "");
                        yearLabel.attr("y", -cardHeight / 2 - 10);
                        yearLabel.style("display", d.year ? "block" : "none");
                    }
                });
                
                // After measuring card heights, trigger re-positioning of people nodes
                // The timeline mode effect will re-run because nodes have changed (d.h updated)
                // and it will position people using actual measured heights
                if (hasChanges) {
                    if (isTimelineMode) {
                        setTimelineLayoutVersion(v => v + 1);
                    }
                    if (simulationRef.current) {
                        // Force effect to re-run by restarting simulation with updated node data
                        setTimeout(() => {
                            if (simulationRef.current) {
                                // Use lower alpha to prevent jarring movements and spinning
                                const currentAlpha = simulationRef.current.alpha();
                                if (currentAlpha < 0.01) {
                                    simulationRef.current.alpha(0.1).restart(); // Lower alpha to reduce spinning
                                } else {
                                    simulationRef.current.alpha(Math.min(currentAlpha + 0.03, 0.3)); // Reduced max alpha
                                }
                            }
                        }, 50);
                    }
                }
            });
        }

        // Background click to deselect
        d3.select(svgRef.current).on("click", (event) => {
            if (event.target === svgRef.current) {
                onNodeClick(null);
                setFocusedNode(null);
            }
        });

        // In timeline mode, show links only for selected person, otherwise hide them
        if (isTimelineMode) {
            allLinks.style("display", d => {
                if (!effectiveFocused) return "none";
                const isPersonNode = effectiveFocused.is_person ?? effectiveFocused.type.toLowerCase() === 'person';
                if (!isPersonNode) return "none";
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target;
                // Show link if it connects to the selected person
                return (sId === effectiveFocused.id || tId === effectiveFocused.id) ? null : "none";
            }).style("stroke-opacity", d => {
                if (!effectiveFocused) return 0;
                const isPersonNode = effectiveFocused.is_person ?? effectiveFocused.type.toLowerCase() === 'person';
                if (!isPersonNode) return 0;
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target;
                return (sId === effectiveFocused.id || tId === effectiveFocused.id) ? 0.9 : 0;
            }).style("stroke", "#dc2626").style("stroke-width", 3.5);
        } else {
            allLinks.style("display", null)
                .style("stroke-opacity", d => {
                    const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source as string;
                    const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target as string;
                    if (dropHighlight.has(sId) || dropHighlight.has(tId)) return 0.12;
                    // Priority 1: Path highlighting - only highlight links that are actually in the path sequence
                    if (hasHighlight && pathLinkIds.has(d.id)) return 0.9;
                    // Priority 2: Other links when path highlighting is active
                    if (hasHighlight && (!keepHighlight.has(sId) || !keepHighlight.has(tId))) return 0.25;
                    // Priority 3: Focused node highlighting
                    if (effectiveFocused) return (sId === effectiveFocused.id || tId === effectiveFocused.id) ? 0.9 : 0.1;
                    return 0.7;
                })
                .style("stroke", d => {
                    const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source as string;
                    const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target as string;
                    if (dropHighlight.has(sId) || dropHighlight.has(tId)) return "#f87171";
                    // Priority 1: Path highlighting - only highlight links that are actually in the path sequence
                    if (hasHighlight && pathLinkIds.has(d.id)) return "#f97316";
                    // Priority 2: Other links when path highlighting is active
                    if (hasHighlight && (!keepHighlight.has(sId) || !keepHighlight.has(tId))) return "#94a3b8";
                    // Priority 3: Focused node highlighting
                    if (effectiveFocused && (sId === effectiveFocused.id || tId === effectiveFocused.id)) return "#f97316";
                    return "#dc2626";
                })
                .style("stroke-width", d => {
                    // Make path links thicker - only for links actually in the path sequence
                    if (hasHighlight && pathLinkIds.has(d.id)) return 3;
                    return 2;
                });
        }

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
});

export default Graph;
