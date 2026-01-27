
const { dedupeGraph, baseDedupeKey } = require('./services/graphUtils.js');

// Mock data simulating Republic (Plato) expansion
const parent = {
    id: 12345, // Numeric ID
    title: "Republic (Plato)",
    type: "Book",
    is_atomic: false,
    x: 500,
    y: 500
};

const processedNodes = [
    {
        id: "Plato", // String ID
        title: "Plato",
        type: "Person",
        is_atomic: true
    },
    {
        id: "Socrates",
        title: "Socrates",
        type: "Person",
        is_atomic: true
    },
    {
        id: "Justice",
        title: "Justice",
        type: "Concept",
        is_atomic: true
    }
];

const prev = {
    nodes: [parent],
    links: []
};

// Simulate the logic in useExpansion.ts
function simulateExpansion(node, processedNodes, prev) {
    const nodeMap = new Map();
    prev.nodes.forEach(n => nodeMap.set(String(n.id), n));
    const existingNodeIds = new Set(prev.nodes.map(n => String(n.id)));

    const expectedChildIsAtomic = !node.is_atomic;

    processedNodes.forEach(cn => {
        const existing = nodeMap.get(String(cn.id));
        nodeMap.set(String(cn.id), {
            id: cn.id,
            title: cn.title,
            type: cn.type,
            is_atomic: cn.is_atomic ?? expectedChildIsAtomic,
            x: existing?.x ?? (node.x + (Math.random() - 0.5) * 100),
            y: existing?.y ?? (node.y + (Math.random() - 0.5) * 100),
            expanded: existing?.expanded || false
        });
    });

    const getLinkId = (thing) => String(typeof thing === 'object' ? thing?.id : thing);
    const candidateLinks = processedNodes.map(cn => ({
        source: node.id,
        target: cn.id,
        id: `${node.id}-${cn.id}`
    }));

    const isAtomicForId = new Map();
    Array.from(nodeMap.values()).forEach(n => {
        isAtomicForId.set(String(n.id), !!n.is_atomic);
    });

    const bipartiteSafeCandidates = candidateLinks.filter(l => {
        const sid = getLinkId(l.source);
        const tid = getLinkId(l.target);
        const sa = isAtomicForId.get(sid);
        const ta = isAtomicForId.get(tid);
        console.log(`Checking link ${sid} -> ${tid}: atomicSource=${sa}, atomicTarget=${ta}`);
        if (sa === undefined || ta === undefined) return true;
        return sa !== ta;
    });

    console.log(`Bipartite safe candidates count: ${bipartiteSafeCandidates.length}`);

    const combinedLinks = [...bipartiteSafeCandidates];
    const degree = new Map();
    combinedLinks.forEach(l => {
        const s = getLinkId(l.source);
        const t = getLinkId(l.target);
        degree.set(s, (degree.get(s) || 0) + 1);
        degree.set(t, (degree.get(t) || 0) + 1);
    });

    const finalNodes = Array.from(nodeMap.values()).filter(n =>
        String(n.id) === String(node.id) ||
        existingNodeIds.has(String(n.id)) ||
        (degree.get(String(n.id)) || 0) > 0
    );

    console.log(`Final nodes count: ${finalNodes.length}`);
    console.log(`Final links count: ${combinedLinks.length}`);

    return dedupeGraph(finalNodes, combinedLinks);
}

const result = simulateExpansion(parent, processedNodes, prev);
console.log('Result Nodes:', result.nodes.map(n => n.title));
console.log('Result Links:', result.links.map(l => l.id));
