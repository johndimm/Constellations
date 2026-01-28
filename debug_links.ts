import { dedupeGraph } from './services/graphUtils';
import { GraphNode, GraphLink } from './types';

const parent: GraphNode = {
    id: 12345,
    title: "Republic (Plato)",
    type: "Book",
    is_atomic: false,
    x: 500,
    y: 500,
    expanded: false
};

const processedNodes: GraphNode[] = [
    {
        id: "Plato",
        title: "Plato",
        type: "Person",
        is_atomic: true,
        expanded: false
    },
    {
        id: "Socrates",
        title: "Socrates",
        type: "Person",
        is_atomic: true,
        expanded: false
    }
];

const prev = {
    nodes: [parent],
    links: [] as GraphLink[]
};

function simulateExpansion(node: GraphNode, expansionTargets: GraphNode[], prevData: { nodes: GraphNode[], links: GraphLink[] }) {
    const nodeMap = new Map<string, GraphNode>();
    prevData.nodes.forEach(n => nodeMap.set(String(n.id), n));
    const existingNodeIds = new Set(prevData.nodes.map(n => String(n.id)));

    const expectedChildIsAtomic = !node.is_atomic;

    expansionTargets.forEach(cn => {
        const existing = nodeMap.get(String(cn.id));
        nodeMap.set(String(cn.id), {
            ...cn,
            is_atomic: cn.is_atomic ?? expectedChildIsAtomic,
            x: existing?.x ?? (node.x! + (Math.random() - 0.5) * 100),
            y: existing?.y ?? (node.y! + (Math.random() - 0.5) * 100),
        });
    });

    const getLinkId = (thing: any) => String(typeof thing === 'object' ? thing?.id : thing);
    const candidateLinks: GraphLink[] = expansionTargets.map(cn => ({
        source: node.id,
        target: cn.id,
        id: `${node.id}-${cn.id}`
    }));

    const isAtomicForId = new Map<string, boolean>();
    Array.from(nodeMap.values()).forEach(n => {
        isAtomicForId.set(String(n.id), !!n.is_atomic);
    });

    const bipartiteSafeCandidates = candidateLinks.filter(l => {
        const sid = getLinkId(l.source);
        const tid = getLinkId(l.target);
        const sa = isAtomicForId.get(sid);
        const ta = isAtomicForId.get(tid);
        // console.log(`Checking link ${sid} -> ${tid}: atomicSource=${sa}, atomicTarget=${ta}`);
        if (sa === undefined || ta === undefined) return true;
        return sa !== ta;
    });

    // console.log(`Bipartite safe candidates count: ${bipartiteSafeCandidates.length}`);

    const degree = new Map<string, number>();
    bipartiteSafeCandidates.forEach(l => {
        const s = getLinkId(l.source);
        const t = getLinkId(l.target);
        degree.set(s, (degree.get(s) || 0) + 1);
        degree.set(t, (degree.get(t) || 0) + 1);
    });

    const filteredNodes = Array.from(nodeMap.values()).filter(n =>
        String(n.id) === String(node.id) ||
        existingNodeIds.has(String(n.id)) ||
        (degree.get(String(n.id)) || 0) > 0
    );

    // console.log(`Filtered nodes count: ${filteredNodes.length}`);

    return dedupeGraph(filteredNodes, bipartiteSafeCandidates);
}

const result = simulateExpansion(parent, processedNodes, prev);
// console.log('Result Nodes:', result.nodes.map(n => n.title));
// console.log('Result Links:', result.links.map(l => l.id));
