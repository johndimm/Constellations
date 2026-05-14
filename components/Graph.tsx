"use client";
import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphLink } from '../types';
import { buildWikiUrl } from '../utils/wikiUtils';

interface GraphProps {
    nodes: GraphNode[];
    links: GraphLink[];
    onNodeClick: (node: GraphNode | null, event?: MouseEvent) => void;
    onLinkClick?: (link: GraphLink) => void;
    onViewportChange?: (visibleNodes: GraphNode[]) => void;
    width: number;
    height: number;
    isCompact?: boolean;
    isTimelineMode?: boolean;
    isTextOnly?: boolean;
    searchId?: number;
    selectedNode?: GraphNode | null;
    expandingNodeId?: number | string | null;
    newChildNodeIds?: Set<number | string>;
    highlightKeepIds?: (number | string)[];
    highlightDropIds?: (number | string)[];
    onNodeContextMenu?: (event: MouseEvent, node: GraphNode) => void;
}

export interface GraphHandle {
    centerOnNode: (nodeId: string | number, scale?: number) => void;
    /** Pans and zooms so all nodes (with padding) fit in the graph viewport. */
    fitGraphInView: () => void;
}

const DEFAULT_CARD_SIZE = 220;

// Helper to sanitize IDs for DOM selectors
const safeId = (id: string | number) => String(id).replace(/[^a-zA-Z0-9-_]/g, '_');

/**
 * Text for link hover: relationship label (from the LLM / expansion) plus supporting evidence snippet when present.
 */
function formatLinkHoverText(l: GraphLink): string | null {
    const label = (l.label || '').trim();
    const ev = l.evidence;
    const sn = (ev?.snippet || '').trim();
    if (ev?.kind === 'none') {
        if (label) return label;
        if (sn) return sn;
        return null;
    }
    if (label && sn && sn !== label) return `${label}\n\n${sn}`;
    if (label) return label;
    if (sn) return sn;
    return null;
}

/** Stabilize link ends for d3.forceLink: Map keys are String(node.id) so endpoints must be the same. */
const linkEndpointId = (e: string | number | GraphNode | null | undefined) => {
    if (e != null && typeof e === 'object' && 'id' in (e as object)) {
        return String((e as GraphNode).id);
    }
    return String(e);
};

const Graph = forwardRef<GraphHandle, GraphProps>((props, ref) => {
    const {
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
        expandingNodeId = null,
        newChildNodeIds = new Set<number | string>(),
        highlightKeepIds = [],
        highlightDropIds = [],
        onNodeContextMenu,
    } = props;
    const svgRef = useRef<SVGSVGElement>(null);
    const zoomGroupRef = useRef<SVGGElement>(null);
    const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
    const [hoveredLinkId, setHoveredLinkId] = useState<string | number | null>(null);
    const [linkTip, setLinkTip] = useState<{ link: GraphLink; x: number; y: number } | null>(null);
    const linkHoverWrapRef = useRef<HTMLDivElement>(null);
    const [focusedNode, setFocusedNode] = useState<GraphNode | null>(null);
    const [timelineLayoutVersion, setTimelineLayoutVersion] = useState(0);
    const wasTimelineRef = useRef(isTimelineMode);
    const timelinePositionsRef = useRef(new Map<string | number, { x: number, y: number }>());

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
        if (isPerson ?? (type.toLowerCase() === 'person' || type.toLowerCase() === 'actor')) return '#f59e0b';
        return '#3b82f6';
    }

    function escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    const isAtomicNode = useCallback((node: GraphNode) => node.is_atomic === true || node.is_person === true, []);

    const timelineNodes = useMemo(() => {
        return nodes
            .filter(n => !isAtomicNode(n))
            .sort((a, b) => {
                const hasA = a.year !== undefined && a.year !== null && a.year !== 0;
                const hasB = b.year !== undefined && b.year !== null && b.year !== 0;

                // Sort undated to the end
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;

                if (hasA && hasB) {
                    const yearA = Number(a.year ?? 0);
                    const yearB = Number(b.year ?? 0);
                    if (yearA !== yearB) return yearA - yearB;
                }

                return String(a.id).localeCompare(String(b.id));
            });
    }, [nodes, isAtomicNode]);

    // Calculate dynamic dimensions for nodes
    const getNodeDimensions = (node: GraphNode, isTimeline: boolean, textOnly: boolean): { w: number, h: number, r: number, type: string } => {
        if (isAtomicNode(node)) {
            if (isTimeline) {
                return { w: 96, h: 96, r: 110, type: 'circle' };
            } else {
                return { w: 48, h: 48, r: 55, type: 'circle' };
            }
        }

        if (isTimeline) {
            return {
                w: DEFAULT_CARD_SIZE,
                h: DEFAULT_CARD_SIZE,
                r: 120,
                type: 'card'
            };
        } else {
            return { w: 60, h: 60, r: 60, type: 'box' };
        }
    };

    /** Graph-space position for layout / timeline fixed positions. */
    const getNodeLayoutPos = useCallback(
        (n: GraphNode): { x: number; y: number } | null => {
            if (isTimelineMode) {
                const fixed = timelinePositionsRef.current.get(n.id);
                if (fixed) return { x: fixed.x, y: fixed.y };
            }
            if (n.x !== undefined && n.y !== undefined) return { x: n.x, y: n.y };
            return null;
        },
        [isTimelineMode]
    );

    /** Radius in graph space around each node for bounding (matches collision / drawing). */
    const getNodeRadiusForBounds = useCallback(
        (n: GraphNode) => {
            const dims = getNodeDimensions(n, isTimelineMode, isTextOnly);
            if (isTimelineMode && dims.type === "card") {
                const h = (n as GraphNode & { h?: number }).h ?? dims.h;
                return Math.max(dims.w, h, dims.r) / 2;
            }
            return Math.max(dims.r, Math.max(dims.w, dims.h) / 2, 20);
        },
        [isTimelineMode, isTextOnly]
    );

    const fitGraphInView = useCallback(() => {
        if (!svgRef.current || !zoomBehaviorRef.current) return;
        const list = nodes;
        if (!list.length) return;

        const pad = Math.max(32, 0.04 * Math.min(width, height));
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let any = false;

        for (const n of list) {
            const p = getNodeLayoutPos(n);
            if (!p) continue;
            any = true;
            const r = getNodeRadiusForBounds(n);
            minX = Math.min(minX, p.x - r);
            maxX = Math.max(maxX, p.x + r);
            minY = Math.min(minY, p.y - r);
            maxY = Math.max(maxY, p.y + r);
        }
        if (!any || !Number.isFinite(minX)) return;

        const graphW = Math.max(1, maxX - minX);
        const graphH = Math.max(1, maxY - minY);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        let k = Math.min((width - 2 * pad) / graphW, (height - 2 * pad) / graphH);
        // d3 scaleExtent; never zoom in past ~1.4× for a tiny / single-node graph (avoid “magnify one card”)
        if (graphW < 0.4 * width && graphH < 0.4 * height) {
            k = Math.min(k, 1.4);
        }
        k = Math.min(4, Math.max(0.1, k));

        const svg = d3.select(svgRef.current);
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(k)
            .translate(-midX, -midY);

        svg.transition().duration(800).call(zoomBehaviorRef.current.transform, transform);
    }, [nodes, width, height, getNodeLayoutPos, getNodeRadiusForBounds]);

    const centerOnNode = useCallback((nodeId: string | number, scale?: number) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node || !svgRef.current || !zoomBehaviorRef.current) return;

        const svg = d3.select(svgRef.current);
        const currentTransform = d3.zoomTransform(svgRef.current);

        let targetX = node.x;
        let targetY = node.y;

        if (isTimelineMode) {
            const fixed = timelinePositionsRef.current.get(nodeId);
            if (fixed) {
                targetX = fixed.x;
                targetY = fixed.y;
            }
        }

        if (targetX === undefined) targetX = width / 2;
        if (targetY === undefined) targetY = height / 2;

        const k = scale !== undefined ? scale : currentTransform.k;
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(k)
            .translate(-targetX, -targetY);

        svg.transition().duration(800).call(zoomBehaviorRef.current.transform, transform);
    }, [nodes, width, height, isTimelineMode]);

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

    const nodesRef = useRef(nodes);
    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    const centerOnNodeRef = useRef(centerOnNode);
    centerOnNodeRef.current = centerOnNode;
    const fitGraphInViewRef = useRef(fitGraphInView);
    fitGraphInViewRef.current = fitGraphInView;

    useImperativeHandle(
        ref,
        () => ({
            centerOnNode,
            fitGraphInView,
        }),
        [centerOnNode, fitGraphInView]
    );

    // After selection, fit the whole graph in the viewport (200ms: allow layout to place x/y).
    useEffect(() => {
        if (!selectedNode) return;
        const t = setTimeout(() => fitGraphInViewRef.current(), 200);
        return () => clearTimeout(t);
    }, [selectedNode?.id]);

    // When entering timeline mode, show the full layout in view
    useEffect(() => {
        if (isTimelineMode && timelineNodes.length > 0) {
            const timer = setTimeout(() => fitGraphInViewRef.current(), 150);
            return () => clearTimeout(timer);
        }
    }, [isTimelineMode, timelineNodes, fitGraphInView]);

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
    // Initialize Zoom (Simulation is managed in the main update effect)
    useEffect(() => {
        if (!svgRef.current) return;

        // Initialize Zoom Behavior
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

        d3.select(svgRef.current).call(zoom);
        zoomBehaviorRef.current = zoom;

        // Cleanup simulation on unmount
        return () => {
            if (simulationRef.current) {
                simulationRef.current.stop();
            }
        };
    }, [width, height]); // Only re-run if dimensions change (or on mount)


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

            if (isTimelineMode && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                // Navigate chronologically
                const currentIndex = selectedNode ? timelineNodes.findIndex(n => n.id === selectedNode.id) : -1;
                let nextNode = null;

                if (event.key === 'ArrowRight') {
                    if (currentIndex === -1) nextNode = timelineNodes[0];
                    else if (currentIndex < timelineNodes.length - 1) nextNode = timelineNodes[currentIndex + 1];
                } else if (event.key === 'ArrowLeft') {
                    if (currentIndex > 0) nextNode = timelineNodes[currentIndex - 1];
                }

                if (nextNode) {
                    onNodeClick(nextNode);
                    return;
                }
            }

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
    }, [isTimelineMode, timelineNodes, selectedNode, onNodeClick, width, height]);

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
                    const cardHeight = (d as GraphNode & { h?: number }).h ?? dims.h;
                    // Use the diagonal distance plus padding to ensure no overlap
                    const maxDimension = Math.max(cardWidth, cardHeight);
                    return (maxDimension / 2) + 15; // Increased padding to prevent overlap
                }
                if (isCompact) {
                    // Tighter packing for compact mode, but prevent text overlap
                    // Increased padding from +8 to +20 to account for labels
                    if (dims.type === 'circle') return (dims.w / 2) + 20;
                    if (dims.type === 'box') return (dims.w / 2) + 20;
                    // Cards are large, keep standard collision but maybe tighter
                    return dims.r * 0.8;
                }
                return dims.r + 15;
            })
            .strength(isTimelineMode ? 0.5 : 0.8) // Lower collision for timeline since events are fixed
            .iterations(isTimelineMode ? 3 : 3);

        simulation.force("collidePeople", null);
        simulation.force("collideEvents", null);
        simulation.force("collide", collideForce);

        if (isTimelineMode) {
            const prevPositions = new Map<string | number, { x: number; y: number }>(timelinePositionsRef.current);

            const lockNodePosition = (node: GraphNode, x: number, y: number) => {
                node.fx = x;
                node.fy = y;
                node.x = x;
                node.y = y;
                node.vx = 0;
                node.vy = 0;
                timelinePositionsRef.current.set(node.id, { x, y });
            };



            const nodeIndexMap = new Map<string | number, number>(
                timelineNodes.map((n, i) => [n.id, i] as [string | number, number])
            );

            const itemSpacing = 280; // More horizontal breathing room
            const vGap = 300; // Vertical distance between staggered dated events
            const tierGap = 350; // Vertical distance between tiered layers
            const personRadius = 110;
            const minPersonDistance = personRadius * 2 + 50;

            const totalWidth = timelineNodes.length * itemSpacing;
            const startX = -(totalWidth / 2) + (itemSpacing / 2);
            const centerY = height / 2;

            // Reset all fixed positions first
            nodes.forEach(node => {
                node.fx = null;
                node.fy = null;
                const prev = prevPositions.get(node.id);
                if (prev) {
                    node.x = prev.x;
                    node.y = prev.y;
                }
            });

            // tier 3: Fix timeline event positions (Bottom)
            timelineNodes.forEach((node, index) => {
                const fixedX = width / 2 + startX + (index * itemSpacing);
                const fixedY = centerY + ((index % 2 === 0) ? -vGap / 4 : vGap / 4);
                lockNodePosition(node, fixedX, fixedY);
            });

            // tier 1: Position people (Top)
            const peopleNodes = nodes.filter(isAtomicNode);
            const availableWidth = Math.min(Math.max(totalWidth, width), width * 2);

            // Compute desired X for people based on connections to placed events
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
                        return nodes.find(n => n.id === eventId && n.year !== undefined && !isAtomicNode(n));
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
            desiredPositions.sort((a, b) => a.desiredX - b.desiredX);

            const peoplePerRow = Math.max(1, Math.floor(availableWidth / minPersonDistance));
            const totalPeopleRows = Math.ceil(desiredPositions.length / peoplePerRow);
            const topTierYBase = centerY - tierGap - (totalPeopleRows * minPersonDistance);

            desiredPositions.forEach((entry, index) => {
                const { person } = entry;
                const row = Math.floor(index / peoplePerRow);
                const col = index % peoplePerRow;
                const countInRow = Math.min(peoplePerRow, desiredPositions.length - row * peoplePerRow);
                const rWidth = (countInRow - 1) * minPersonDistance;
                const rStartX = width / 2 - (rWidth / 2);
                lockNodePosition(person, rStartX + col * minPersonDistance, topTierYBase + row * minPersonDistance);
            });

            // tier 2: (Removed separate unknown-year tier, now merged into timelineNodes)

            // Safety net: ensure every node has a fixed position to eliminate wandering cards
            nodes.forEach((node, idx) => {
                if (!timelinePositionsRef.current.has(node.id)) {
                    const fallbackX = width / 2 + (idx * 40);
                    const fallbackY = centerY - tierGap;
                    lockNodePosition(node, fallbackX, fallbackY);
                } else {
                    const locked = timelinePositionsRef.current.get(node.id)!;
                    node.fx = locked.x;
                    node.fy = locked.y;
                    node.x = locked.x;
                    node.y = locked.y;
                    node.vx = 0;
                    node.vy = 0;
                }
            });

            if (centerForce) centerForce.strength(0.01);
            if (chargeForce) chargeForce.strength(-50);
            if (linkForce) linkForce.strength(0);

            simulation.force("x", null);
            simulation.force("y", null);
            simulation.velocityDecay(0.9);

        } else {
            timelinePositionsRef.current.clear();
            // Reset fixed positions for non-timeline mode
            nodes.forEach(node => {
                node.fx = null;
                node.fy = null;

                // Initialize new nodes to center to prevent flying in from top-left (0,0)
                // We check for undefined or NaN. We strictly check x AND y to act on fresh nodes.
                if ((node.x === undefined || isNaN(node.x)) && width > 0 && height > 0) {
                    node.x = width / 2 + (Math.random() - 0.5) * 10; // Tiny jitter to prevent stacking overlap
                    node.y = height / 2 + (Math.random() - 0.5) * 10;
                }
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

        // Only use continuous animation in timeline mode when simulation might still be settling
        // In normal mode, the simulation tick handler will update positions
        if (!isTimelineMode) {
            // Initial render only for non-timeline mode (tick handler will update)
            render();
            return;
        }

        // In timeline mode with fixed positions, render periodically but not every frame
        let lastRender = 0;
        const renderInterval = 16; // ~60fps max
        let frame = requestAnimationFrame(function loop() {
            const now = performance.now();
            if (now - lastRender >= renderInterval) {
                render();
                lastRender = now;
            }
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
        } else if (!wasTimeline && isTimelineMode && timelineNodes.length > 0) {
            setTimeout(() => {
                fitGraphInView();
            }, 100);
        }
        wasTimelineRef.current = isTimelineMode;
    }, [isTimelineMode, nodes, width, height, timelineNodes, centerOnNode, fitGraphInView]);

    // 4. Structural Effect: Only runs when overall graph structure (nodes/links) changes.
    // This handles D3 enter/exit/merge and restarts the simulation.
    useEffect(() => {
        if (!zoomGroupRef.current) return;

        // 1. Calculate valid links first (string ids only — d3 forceLink's nodeById map uses .id() keys)
        const nodeIdSet = new Set(nodes.map(n => String(n.id)));
        const validLinks = links
            .map(link => {
                const sId = linkEndpointId(link.source as string | number | GraphNode);
                const tId = linkEndpointId(link.target as string | number | GraphNode);
                return { link, sId, tId };
            })
            .filter(
                ({ sId, tId }) =>
                    sId.length > 0 &&
                    tId.length > 0 &&
                    sId !== 'undefined' &&
                    tId !== 'undefined' &&
                    nodeIdSet.has(sId) &&
                    nodeIdSet.has(tId)
            )
            .map(({ link, sId, tId }) => ({
                ...link,
                source: sId,
                target: tId
            }));

        // 2. Lazily create simulation if it doesn't exist
        if (!simulationRef.current) {
            simulationRef.current = d3.forceSimulation<GraphNode, GraphLink>(nodes)
                .force("link", d3.forceLink<GraphNode, GraphLink>(validLinks).id(d => String(d.id)).distance(100))
                .force("charge", d3.forceManyBody().strength(-300))
                .force("center", d3.forceCenter(width / 2, height / 2))
                .velocityDecay(0.6)
                .alphaDecay(0.02);
        }

        const simulation = simulationRef.current;
        const container = d3.select(zoomGroupRef.current);

        // Update center force in case dimensions changed
        simulation.force("center", d3.forceCenter(width / 2, height / 2));


        // Wide invisible hit-area for easier clicking on links
        const linkHitSel = container.selectAll<SVGPathElement, GraphLink>(".link-hit").data(validLinks, d => d.id);
        linkHitSel.exit().remove();
        const linkHitEnter = linkHitSel.enter().insert("path", ".node")
            .attr("class", "link-hit")
            .attr("fill", "none")
            .attr("stroke", "transparent")
            .attr("stroke-opacity", 0)
            .attr("stroke-width", 14)
            .attr("stroke-linecap", "round")
            .style("pointer-events", "stroke");

        const linkHitMerged = linkHitSel.merge(linkHitEnter);
        if (isTimelineMode) {
            linkHitMerged.style("display", "none");
        } else {
            linkHitMerged.style("display", null);
        }

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

        // Link click (optional) + hover highlight + tooltip (label + LLM / evidence text)
        const placeLinkTip = (event: MouseEvent) => {
            const root = linkHoverWrapRef.current;
            if (!root) return null;
            const r = root.getBoundingClientRect();
            return { x: event.clientX - r.left, y: event.clientY - r.top };
        };
        const hoverInLink = (event: any, d: GraphLink) => {
            setHoveredLinkId(d.id);
            const p = placeLinkTip(event as MouseEvent);
            if (p && formatLinkHoverText(d)) {
                setLinkTip({ link: d, x: p.x, y: p.y });
            } else {
                setLinkTip(null);
            }
        };
        const moveLink = (event: any, d: GraphLink) => {
            const p = placeLinkTip(event as MouseEvent);
            if (!p) return;
            if (formatLinkHoverText(d)) {
                setLinkTip({ link: d, x: p.x, y: p.y });
            }
        };
        const hoverOutLink = () => {
            setHoveredLinkId(null);
            setLinkTip(null);
        };
        if (onLinkClick) {
            const clickHandler = (event: any, d: GraphLink) => {
                event.stopPropagation();
                onLinkClick(d);
            };
            linkMerged
                .style("cursor", "pointer")
                .on("click", clickHandler)
                .on("mouseover", hoverInLink)
                .on("mousemove", moveLink)
                .on("mouseout", hoverOutLink);
            linkHitMerged
                .style("cursor", "pointer")
                .on("click", clickHandler)
                .on("mouseover", hoverInLink)
                .on("mousemove", moveLink)
                .on("mouseout", hoverOutLink);
        } else {
            linkMerged
                .style("cursor", "default")
                .on("click", null)
                .on("mouseover", hoverInLink)
                .on("mousemove", moveLink)
                .on("mouseout", hoverOutLink);
            linkHitMerged
                .style("cursor", "default")
                .on("click", null)
                .on("mouseover", hoverInLink)
                .on("mousemove", moveLink)
                .on("mouseout", hoverOutLink);
        }

        const nodeSel = container.selectAll<SVGGElement, GraphNode>(".node").data(nodes, d => d.id);
        const nodeEnter = nodeSel.enter().append("g")
            .attr("class", "node");

        // Create drag behavior - only allow dragging if not in timeline mode, or if not a person node in timeline mode
        const dragBehavior = d3.drag<SVGGElement, GraphNode>()
            .on("start", (event, d) => {
                if (isTimelineMode) {
                    if (isAtomicNode(d)) {
                        event.sourceEvent.stopPropagation();
                        return; // Don't allow dragging people in timeline mode
                    }
                }
                dragstarted(event, d);
            })
            .on("drag", (event, d) => {
                if (isTimelineMode) {
                    if (isAtomicNode(d)) return; // Don't allow dragging people in timeline mode
                }
                dragged(event, d);
            })
            .on("end", (event, d) => {
                if (isTimelineMode) {
                    if (isAtomicNode(d)) return; // Don't allow dragging people in timeline mode
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
            .attr("id", d => `clip-circle-${safeId(d.id)}`)
            .append("circle").attr("cx", 0).attr("cy", 0);

        defs.append("clipPath")
            .attr("id", d => `clip-rect-${safeId(d.id)}`)
            .append("rect").attr("x", 0).attr("y", 0);

        defs.append("clipPath")
            .attr("id", d => `clip-desc-${safeId(d.id)}`)
            .append("rect").attr("x", 0).attr("y", 0);

        nodeEnter.append("image").style("pointer-events", "none");

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
            .attr("fill", "#fbbf24"); // amber-400

        // Click and Context Menu listeners
        const clickHandler = (event: any, d: GraphNode) => {
            // If dragging occurred, don't trigger click
            // (Assuming standard D3 pattern: if moved small amount, it's a click)
            onNodeClick(d, event as MouseEvent);
        };
        const contextMenuHandler = (event: any, d: GraphNode) => {
            if (onNodeContextMenu) {
                event.preventDefault();
                onNodeContextMenu(event, d);
            }
        };

        const hoverIn = (_event: any, d: GraphNode) => setHoveredNode(d);
        const hoverOut = () => setHoveredNode(null);

        nodeEnter.merge(nodeSel)
            .style("cursor", "pointer")
            .on("click", clickHandler)
            .on("contextmenu", contextMenuHandler)
            .on("mouseover", hoverIn)
            .on("mouseout", hoverOut);


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

        // STABILIZATION: Copy positions from old simulation nodes to new data to prevent "jumping"
        const oldNodes = simulation.nodes();
        const oldNodeMap = new Map(oldNodes.map(n => [n.id, n]));
        nodes.forEach(n => {
            const old = oldNodeMap.get(n.id);
            if (old) {
                // Preserve physics state
                const oldNode = old as GraphNode;
                if (n.x === undefined || isNaN(n.x)) n.x = oldNode.x;
                if (n.y === undefined || isNaN(n.y)) n.y = oldNode.y;
                if (n.vx === undefined || isNaN(n.vx)) n.vx = oldNode.vx;
                if (n.vy === undefined || isNaN(n.vy)) n.vy = oldNode.vy;
            }
        });

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

                if (!source || !target || typeof source !== 'object' || typeof target !== 'object') {
                    // Diagnostic log for disconnected links
                    if (prevNodesLen.current > 0) {
                        console.warn(`🔗 [LinkPath] Disconnected link detected: ID=${d.id}, source=${typeof d.source}, target=${typeof d.target}`);
                    }
                    return null;
                }

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
    }, [nodes, links, isTimelineMode, width, height, onLinkClick]);

    // 5. Stylistic Effect: Update colors, opacity, labels without restarting simulation
    useEffect(() => {
        if (!zoomGroupRef.current) return;
        const container = d3.select(zoomGroupRef.current);

        const keepHighlight = new Set(highlightKeepIds || []);
        const dropHighlight = new Set(highlightDropIds || []);
        const hasHighlight = keepHighlight.size > 0 || dropHighlight.size > 0;

        // Build set of path links (links between consecutive nodes in the path)
        // IMPORTANT: Only highlight links that actually exist and are part of the path sequence
        const pathLinkIds = new Set<string | number>();
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
        const eventToPeople = new Map<string | number, string[]>();
        if (isTimelineMode) {
            links.forEach(l => {
                const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;

                // Use loose comparison or string normalization for IDs
                const sourceNode = nodes.find(n => String(n.id) === String(sId));
                const targetNode = nodes.find(n => String(n.id) === String(tId));

                // console.log(`[Timeline Scan Debug] Link ${sId} -> ${tId}. Found Source? ${!!sourceNode} (${sourceNode?.title}), Found Target? ${!!targetNode} (${targetNode?.title})`);

                if (sourceNode && targetNode) {
                    const isSourceAtomic = isAtomicNode(sourceNode);
                    const isTargetAtomic = isAtomicNode(targetNode);



                    if (isSourceAtomic && !isTargetAtomic) {
                        const atomics = eventToPeople.get(targetNode.id) || [];
                        if (!atomics.includes(sourceNode.title)) {
                            atomics.push(sourceNode.title);
                            eventToPeople.set(targetNode.id, atomics);
                        }
                    }
                    else if (isTargetAtomic && !isSourceAtomic) {
                        const atomics = eventToPeople.get(sourceNode.id) || [];
                        if (!atomics.includes(targetNode.title)) {
                            atomics.push(targetNode.title);
                            eventToPeople.set(sourceNode.id, atomics);
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
            // NOTE: Dynamic opacity/stroke logic moved to Stylistic Effect (Effect 5) to handle interaction updates correctly.
            // Effect 4 only sets default structural attributes.
            let color = getNodeColor(d.type, d.is_person);

            // Default initial styles (will be overridden by Effect 5 immediately)
            const baseOpacity = 1;
            g.style("opacity", d.isLoading ? 1 : baseOpacity);

            const strokeColor = "#fff";
            const strokeWidth = 2;

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
                g.select("image")
                    .style("display", (d.imageUrl && !isTextOnly) ? "block" : "none")
                    .attr("href", d.imageUrl || "")
                    .attr("x", -r)
                    .attr("y", -r)
                    .attr("width", r * 2)
                    .attr("height", r * 2)
                    .attr("preserveAspectRatio", "xMidYMid slice")
                    .attr("clip-path", `url(#clip-circle-${safeId(d.id)})`);
                g.select(`#clip-circle-${safeId(d.id)}`).select("circle").attr("r", r);

                const labelText = g.select(".node-label").style("display", "block").text(null).attr("y", r + 15);
                wrapText(d.title, 90).forEach((line, i) => labelText.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : "1.2em").style("font-size", "10px").text(line));
                const isPerson = d.is_atomic === true || d.is_person === true || d.type?.toLowerCase() === 'person';
                const isEventWithYear = !isPerson && d.year;
                g.select(".year-label").text(d.year || "").attr("y", -r - 10).style("display", (isTimelineMode || isHovered || isEventWithYear) && d.year ? "block" : "none");

            } else {
                const w = dims.w, h = dims.h;
                g.select(".node-rect").style("display", "block").attr("width", w).attr("height", h).attr("x", -w / 2).attr("y", -h / 2).attr("fill", color).attr("stroke", strokeColor).attr("stroke-width", strokeWidth);

                if (dims.type === 'box' && d.imageUrl && !isTextOnly) {
                    g.select("image")
                        .style("display", "block")
                        .attr("href", d.imageUrl)
                        .attr("x", -w / 2)
                        .attr("y", -h / 2)
                        .attr("width", w)
                        .attr("height", h)
                        .attr("preserveAspectRatio", "xMidYMid meet")
                        .attr("clip-path", `url(#clip-rect-${safeId(d.id)})`);
                    g.select(`#clip-rect-${safeId(d.id)}`).select("rect").attr("x", -w / 2).attr("y", -h / 2).attr("width", w).attr("height", h);
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
                        // Uses negative lookbehind to avoid splitting on initials or common abbreviations
                        const sentenceMatch = d.description.match(/^.*?(?<!\b(?:Mr|Ms|Mrs|Dr|Prof|St|v|vs|etc|[A-Z]))[.!?](?:\s+|$)/);
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
                            <div style="font-size: 13px; font-weight: bold; margin-bottom: 8px; line-height: 1.4; word-wrap: break-word; color: #ffffff; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
                                <span>${escapeHtml(d.title)}</span>
                                <a href="${buildWikiUrl(d.title, d.wikipedia_id)}" target="_blank" style="color: #6366f1; flex-shrink: 0; display: flex; align-items: center; margin-top: 1px;" onclick="event.stopPropagation();">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                </a>
                            </div>
                            ${displayDescription ? `<div style="font-size: 11px; margin-bottom: 8px; line-height: 1.4; word-wrap: break-word; color: #cbd5e1;">${escapeHtml(displayDescription)}</div>` : ''}
                            ${hasPeople ? `<div style="font-size: 12px; color: #ffffff; font-weight: 600; line-height: 1.4; word-wrap: break-word; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px; text-transform: capitalize;">${escapeHtml(peopleText)}</div>` : ''}
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

                const isPerson = d.is_atomic === true || d.is_person === true || d.type?.toLowerCase() === 'person';
                const isEventWithYear = !isPerson && d.year;
                g.select(".year-label").text(d.year || "").attr("y", -h / 2 - 10).style("display", (isTimelineMode || isHovered || isEventWithYear) && d.year ? "block" : "none");
            }
            g.select(".spinner-group").style("display", d.isLoading ? "block" : "none")
                .select(".spinner").attr("r", (dims.type === 'circle' || dims.type === 'box') ? (dims.w / 2) + 8 : (dims.h / 2) + 10);

            g.on("click", (event) => {
                if (event.defaultPrevented) return;
                event.stopPropagation();
                onNodeClick(d, event as MouseEvent);
                setFocusedNode(null);
            })
                .on("mouseover", () => setHoveredNode(d))
                .on("mouseout", () => setHoveredNode(null));
        });

        // Batch measure all card heights after browser renders (using requestAnimationFrame)
        if (isTimelineMode) {
            requestAnimationFrame(() => {
                let hasChanges = false;
                allNodes.each(function (d) {
                    if (isAtomicNode(d)) return; // Skip people nodes
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

        // Explicit return void to avoid implicit return of simulation object if that was happening
        return;
    }, [nodes, links, isTimelineMode, width, height]);

    // 5. Stylistic Effect: Visual updates (colors, opacity, stroke) based on hover/interaction
    useEffect(() => {
        if (!zoomGroupRef.current) return;

        const keepHighlight = new Set((highlightKeepIds || []).map(String));
        const dropHighlight = new Set((highlightDropIds || []).map(String));
        const hasHighlight = keepHighlight.size > 0 || dropHighlight.size > 0;

        // Build set of path links
        const pathLinkIds = new Set<string>();
        if (hasHighlight && highlightKeepIds && highlightKeepIds.length > 1) {
            for (let i = 0; i < highlightKeepIds.length - 1; i++) {
                const nodeId1 = String(highlightKeepIds[i]);
                const nodeId2 = String(highlightKeepIds[i + 1]);
                const link = links.find(l => {
                    const sId = String(typeof l.source === 'object' ? (l.source as GraphNode).id : l.source);
                    const tId = String(typeof l.target === 'object' ? (l.target as GraphNode).id : l.target);
                    return (sId === nodeId1 && tId === nodeId2) || (sId === nodeId2 && tId === nodeId1);
                });
                if (link) pathLinkIds.add(String(link.id));
            }
        }

        const neighborIds = new Set<string | number>();
        if (effectiveFocused) {
            links.forEach(l => {
                const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
                const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
                if (sId === effectiveFocused.id) neighborIds.add(tId);
                else if (tId === effectiveFocused.id) neighborIds.add(sId);
            });
        }
        const container = d3.select(zoomGroupRef.current);
        const allLinks = container.selectAll<SVGPathElement, GraphLink>(".link");
        const allNodes = container.selectAll<SVGGElement, GraphNode>(".node");

        allNodes.each(function (d) {
            const g = d3.select(this);
            const isHovered = d.id === hoveredNode?.id;
            const isFocused = d.id === effectiveFocused?.id;
            const isDrop = dropHighlight.has(String(d.id));
            const isKeep = keepHighlight.has(String(d.id));

            let baseOpacity = 1;
            if (isDrop) {
                baseOpacity = 0.18;
            } else if (hasHighlight) {
                baseOpacity = isKeep ? 1 : 0.3;
            } else {
                if (expandingNodeId !== null) {
                    const isExpanding = String(expandingNodeId) === String(d.id);
                    const isNewChild = newChildNodeIds.has(String(d.id));
                    if (!isExpanding && !isNewChild) baseOpacity = 0.25;
                } else if (effectiveFocused) {
                    const isNewChild = newChildNodeIds.has(String(d.id));
                    const isFocused = String(d.id) === String(effectiveFocused.id);
                    // Use neighborIds (which are potentially mixed types) carefully by stringifying
                    // We need to check if neighborIds HAS d.id
                    const isNeighbor = Array.from(neighborIds).some(nid => String(nid) === String(d.id));

                    if (!isFocused && !isNeighbor && !isNewChild) baseOpacity = 0.25;
                }
            }
            g.style("opacity", d.isLoading ? 1 : baseOpacity);

            const isPathHighlight = hasHighlight && dropHighlight.size === 0;
            const strokeColor = isDrop
                ? "#f87171"
                : (isKeep && hasHighlight
                    ? (isPathHighlight ? "#f59e0b" : "#22c55e")
                    : (isHovered || isFocused ? "#f59e0b" : "#fff"));
            const strokeWidth = isDrop ? 3.5 : (isKeep && hasHighlight ? (isPathHighlight ? 3.5 : 2.5) : (isFocused ? 3 : 2));

            g.select(".node-circle").style("stroke", strokeColor).style("stroke-width", strokeWidth);
            g.select(".node-rect").style("stroke", strokeColor).style("stroke-width", strokeWidth);

            // Update image visibility based on isTextOnly prop
            const dims = getNodeDimensions(d, isTimelineMode, isTextOnly);
            if (dims.type === 'circle') {
                g.select("image").style("display", (d.imageUrl && !isTextOnly) ? "block" : "none");
            } else if (dims.type === 'box') {
                g.select("image").style("display", (d.imageUrl && !isTextOnly) ? "block" : "none");
            }


            // Ensure correct year label visibility on hover
            const isPerson = d.is_atomic === true || d.is_person === true || d.type?.toLowerCase() === 'person';
            const isEventWithYear = !isPerson && d.year;
            const showYear = (isTimelineMode || isHovered || isEventWithYear) && !!d.year;
            g.select(".year-label").style("display", showYear ? "block" : "none");
        });

        // Background click to deselect
        d3.select(svgRef.current).on("click", (event) => {
            if (event.target === svgRef.current) {
                onNodeClick(null);
                setFocusedNode(null);
            }
        });

        // In timeline mode, show links only for selected node, otherwise hide them
        if (isTimelineMode) {
            allLinks.style("display", d => {
                if (!effectiveFocused) return "none";
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target;
                // Show link if it connects to the selected node
                return (sId === effectiveFocused.id || tId === effectiveFocused.id) ? null : "none";
            }).style("stroke-opacity", d => {
                if (!effectiveFocused) return 0;
                const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source;
                const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target;
                return (sId === effectiveFocused.id || tId === effectiveFocused.id) ? 0.9 : 0;
            });
        }
        allLinks.style("stroke", "#dc2626").style("stroke-width", 3.5);
        if (!isTimelineMode) {
            allLinks.style("display", null)
                .style("stroke-opacity", d => {
                    const sId = String(typeof d.source === 'object' ? (d.source as GraphNode).id : d.source);
                    const tId = String(typeof d.target === 'object' ? (d.target as GraphNode).id : d.target);

                    if (dropHighlight.has(sId) || dropHighlight.has(tId)) return 0.12;

                    if (hasHighlight) {
                        const inPath = keepHighlight.has(sId) && keepHighlight.has(tId);
                        if (inPath) return 0.95;
                        return 0.3; // Dim everything else when path is active
                    }

                    // Expansion/Selection highlighting
                    const isNewSource = newChildNodeIds.has(String(sId)) || newChildNodeIds.has(sId);
                    const isNewTarget = newChildNodeIds.has(String(tId)) || newChildNodeIds.has(tId);

                    if (expandingNodeId !== null) {
                        const sourceBright = String(sId) === String(expandingNodeId) || isNewSource;
                        const targetBright = String(tId) === String(expandingNodeId) || isNewTarget;
                        if (sourceBright && targetBright) return 0.95;
                        if (sourceBright || targetBright) return 0.5;
                        return 0.25;
                    } else if (effectiveFocused) {
                        // neighborIds check needs string normalization too
                        const sIsNeighbor = Array.from(neighborIds).some(nid => String(nid) === String(sId));
                        const tIsNeighbor = Array.from(neighborIds).some(nid => String(nid) === String(tId));

                        const sourceBright = String(sId) === String(effectiveFocused.id) || sIsNeighbor;
                        const targetBright = String(tId) === String(effectiveFocused.id) || tIsNeighbor;
                        if (sourceBright && targetBright) return 0.95;
                        if (sourceBright || targetBright) return 0.5;
                        return 0.25;
                    }

                    if (isNewSource && isNewTarget) return 0.95;
                    if (isNewSource || isNewTarget) return 0.6;
                    if (hoveredLinkId && d.id === hoveredLinkId) return 1;
                    return 0.85;
                })
                .style("stroke", d => {
                    const sId = String(typeof d.source === 'object' ? (d.source as GraphNode).id : d.source);
                    const tId = String(typeof d.target === 'object' ? (d.target as GraphNode).id : d.target);

                    if (dropHighlight.has(sId) || dropHighlight.has(tId)) return "#f87171";

                    if (hasHighlight) {
                        const inPath = pathLinkIds.has(String(d.id));
                        if (inPath) return "#f59e0b"; // Highlight any link between path nodes
                        return "#94a3b8"; // Blue-grey for external noise when path is active
                    }

                    // Hover highlight for links
                    if (hoveredLinkId && d.id === hoveredLinkId) return "#fbbf24";

                    // Priority: Focused node highlighting
                    if (effectiveFocused && (sId === effectiveFocused.id || tId === effectiveFocused.id)) return "#f97316";

                    // Priority: New connections highlighting
                    const isNewSource = newChildNodeIds.has(String(sId)) || newChildNodeIds.has(sId);
                    const isNewTarget = newChildNodeIds.has(String(tId)) || newChildNodeIds.has(tId);
                    if (isNewSource || isNewTarget) return "#ef4444"; // brighter red for new connections

                    return "#dc2626";
                })
                .style("stroke-width", d => {
                    const sId = String(typeof d.source === 'object' ? (d.source as GraphNode).id : d.source);
                    const tId = String(typeof d.target === 'object' ? (d.target as GraphNode).id : d.target);
                    // Hover highlight for links
                    if (hoveredLinkId && d.id === hoveredLinkId) return 6;
                    // Make path links thicker
                    const inPath = keepHighlight.has(sId) && keepHighlight.has(tId);
                    if (hasHighlight && inPath) return 4;
                    return 2;
                });
        }

    }, [nodes, links, isTimelineMode, hoveredNode, hoveredLinkId, effectiveFocused, highlightKeepIds, highlightDropIds, isTextOnly, onNodeClick, expandingNodeId, newChildNodeIds]);

    const linkTipText = linkTip ? formatLinkHoverText(linkTip.link) : null;

    return (
        <div ref={linkHoverWrapRef} className="relative" style={{ width, height }}>
            {linkTip && linkTipText && (
                <div
                    className="pointer-events-none absolute z-[100] max-w-sm rounded-lg border border-slate-600/80 bg-slate-950/95 px-2.5 py-2 text-left text-[11px] leading-snug text-slate-100 shadow-lg backdrop-blur-sm"
                    style={{ left: linkTip.x + 8, top: linkTip.y + 8 }}
                >
                    <p className="whitespace-pre-wrap break-words">{linkTipText}</p>
                </div>
            )}
        <svg
            ref={svgRef}
            width={width}
            height={height}
            className="cursor-move bg-slate-900"
            onClick={() => {
                setHoveredNode(null);
                setFocusedNode(null);
                setHoveredLinkId(null);
                setLinkTip(null);
            }}
        >
            <g ref={zoomGroupRef} />
        </svg>
        </div>
    );
});

export default Graph;
