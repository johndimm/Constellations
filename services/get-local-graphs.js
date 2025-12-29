  const graphs = Object.keys(localStorage)
    .filter(k => k.startsWith('constellations_graph_'))
    .map(k => ({ name: k.replace('constellations_graph_', ''), data:
  JSON.parse(localStorage[k]) }));
  console.log(JSON.stringify(graphs, null, 2));
