# Related Work

Constellations sits at the intersection of (1) sensemaking-oriented visualization and interactive graph exploration, (2) two-mode / affiliation networks and event-centric modeling, and (3) LLM-mediated interfaces that must communicate uncertainty and evidence. We briefly summarize relevant foundations and highlight how Constellations differs in scope: it emphasizes **low-friction exploratory navigation** and **edge-level interpretability** in an open-world setting, rather than statistical inference over a fully observed two-mode matrix.

## Sensemaking and exploratory visualization
Classic work on sensemaking characterizes analysis as an iterative process of foraging, externalizing structure, and revising hypotheses. This perspective motivates interfaces that make it cheap to “try a move,” inspect the result, and backtrack. In InfoVis, interaction models for exploration and task taxonomies provide a language for describing what users do (e.g., search, browse, compare, derive) and for structuring evaluations beyond accuracy.

In this frame, Constellations targets tasks that are often under-emphasized in search-centric evaluation: recall, discovery, and orientation during iterative branching. The system’s bipartite constraint can be viewed as a design mechanism for reducing cognitive load: it narrows the space of possible moves (“expand to the other side”) while remaining expressive across domains.

## Graph exploration interfaces and node-link visualization guidelines
Node-link diagrams enable intuitive local reasoning (“what connects to what?”), but scale poorly without interaction, filtering, and progressive disclosure. Design guidance for node-link diagrams emphasizes readability, avoidance of “hairballs,” and interaction techniques (hover, highlight, selection, focus+context). Constellations embraces progressive disclosure by default: the graph is small and local, and growth is explicitly user-driven through expansion (including bulk expansion of frontier nodes).

## Two-mode / affiliation networks (bipartite graphs)
Two-mode (bipartite) networks are a long-standing model for situations where actors participate in events or belong to groups. Canonical examples include actors↔movies, authors↔papers, boards↔companies, and other membership/affiliation structures. A key methodological lesson is that naively projecting a bipartite network into one mode (e.g., actor–actor) can introduce artifacts; bipartite structure deserves analysis and visualization in its own right.

Constellations adopts bipartiteness not primarily as an analytic device, but as an interaction constraint that simplifies exploration: each step alternates between atomic and composite nodes. Joint spatial displays of affiliation networks (e.g., correspondence-analysis-style embeddings) also provide an important precedent for “map-like” knowledge exploration and inform a future direction of large-scale knowledge cartography.

## Event-centric modeling in cultural heritage and museums
Event-centric cultural heritage modeling emphasizes events as the connective tissue that relates people, places, objects, and documents. The “historical events as meetings” framing aligns strongly with Constellations’ original person↔event concept: an event is any construct that brings multiple people into relation. Constellations generalizes this idea across domains by letting the system infer an appropriate Atomic↔Composite pairing for a seed term.

## LLMs, structured outputs, and evidence/provenance
LLM-based interfaces face a core tension: generative flexibility enables broad coverage, but users need interpretable reasons for what the system shows. Work on provenance and evidence in visualization motivates making “why is this here?” a first-class interaction. Constellations operationalizes this at the edge level: edges carry evidence snippets and a source link, and the UI exposes evidence on selection. This supports user judgment in a low-friction exploration loop without claiming causal conclusions.

## Constellations’ positioning (one paragraph to write later)
Constellations differs from prior bipartite/affiliation network work in that it is **open-world** and **interactive-first**: the graph is constructed locally on demand from natural language queries, and the system emphasizes interpretability via evidence-backed edges rather than statistical inference over a fully observed two-mode matrix. It also differs from static knowledge graph browsers in that the system can adapt its bipartite pairing across domains while maintaining a consistent interaction model.

