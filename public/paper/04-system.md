# System

## Overview
Constellations is an interactive graph explorer that constructs a small, local graph from a user query and supports repeated expansion. The system enforces a bipartite alternation constraint:

- **Atomic nodes**: individual entities or elementary concepts (e.g., Person, Ingredient, Symptom, Player).
- **Composite nodes**: aggregations, works, events, groups, conditions, or other “meeting-like” constructs that connect multiple atomics (e.g., Movie, Recipe, Disease, Team, Historical Event/Incident).

The UI encodes this alternation with distinct visual forms (e.g., circles vs cards) while keeping interactions consistent across domains.

## Data flow (high level)
1. **User query**: user enters a seed entity.
2. **Context retrieval**: fetch lightweight context (e.g., Wikipedia summary) to help disambiguation and mitigate model knowledge gaps.
3. **Type classification**: determine whether the seed is Atomic or Composite and identify the bipartite pair labels (AtomicType↔CompositeType).
4. **Expansion**: call the LLM to propose 8–10 neighbors on the opposite side of the bipartite partition.
5. **Evidence attachment**: each proposed neighbor includes an evidence snippet + page title; selecting an edge reveals the evidence (“why is this connected?”).
6. **Caching**: store nodes and edges (with evidence) in a database to reduce repeated calls and support persistence.

## Bipartite constraint and “events as meetings”
The original domain (people↔events) is motivated by an event-centric view: an event is any construct that brings multiple people into relation. This framing generalizes naturally to other domains by choosing a Composite that aggregates multiple Atomics and for which the inverse membership relation is meaningful (e.g., actors in films; ingredients in recipes).

## Evidence-backed edges
Each edge carries structured evidence:
- **kind**: currently “ai” (LLM-provided) or “none”
- **snippet**: one sentence
- **pageTitle + url**: where the snippet is claimed to come from (typically a Wikipedia page)

Selecting an edge displays this evidence in the sidebar. The goal is not to “prove” an edge, but to support interpretability and user judgment during exploration.

## Figures (screenshots)
The experience is dynamic (the graph reconfigures as nodes are added; users can drag nodes to reshape local structure). A few static screenshots help convey the interaction model:

In Figure 1, expanding a composite (film) reveals connected atomic entities (people) and supporting evidence.

![Figure 1. The Godfather expansion (screenshot)](/godfather-brando.png){width=60%}

Figure 2 illustrates the timeline view, where temporal metadata provides a second organizing lens alongside the network layout.

![Figure 2. Timeline view example (screenshot)](/godfather-timeline.png){width=60%}

Figure 3 shows a path-seeking example: finding a bipartite path between two entities.

![Figure 3. Path-seeking example (screenshot)](/John%20Von%20Neumann%20to%20Geoffrey%20Hinton.png){width=60%}

Figure 4 shows the people browser used to seed exploration.

![Figure 4. Browse People (screenshot)](/people.png){width=60%}

### Cross-domain examples (Atomic↔Composite generalization)
Figures 5–7 show the same interaction model applied across domains.

![Figure 5. Culinary: Beef (screenshot)](/beef.png){width=60%}

![Figure 6. Sports: LeBron James (screenshot)](/LeBron%20James.png){width=60%}

![Figure 7. Medicine: Sore Throat (screenshot)](/sore%20throat.png){width=60%}

For motion, the repo includes a short demo video: `/demo.mp4`.

### Demo video (in-browser)
The embedded video can render as a black frame in some contexts, so we include a representative still frame instead:

![Figure 8. Demo frame (click through to watch the video)](/demo-frame.png){width=60%}

[Watch the demo video](/demo.mp4)

## Interaction design: low-friction branching
Constellations is optimized for low commitment per step:
- expanding a node is a single click,
- backing up (choosing a different node) is immediate,
- bulk operations allow quick frontier growth (e.g., expand all leaf/frontier nodes across the whole graph).

This interaction model encourages “try and see” exploration, where users do not need to decide a path “once and for all.”

## Caching and persistence
To keep exploration responsive and reduce repeated API calls, Constellations caches:
- **nodes** (title, type, summaries, images, and classification metadata), and
- **edges** (role/label and evidence metadata).

Caching supports repeated browsing, saving/loading graphs, and revisiting a previously explored frontier with evidence intact.

## Implementation notes (to expand later)
- **Graph rendering**: force-directed layout with interaction primitives (hover highlight, edge selection).
- **Expansion strategy**: request a bounded number of neighbors (8–10) to keep the interface comprehensible.
- **Guardrails**: enforce named-entity outputs and require per-edge evidence in the LLM schema to improve interpretability.
- **Failure modes**: ambiguity, generic outputs, and recency; mitigations include context-first classification and evidence requirements.

## Implementation notes (to expand later)
- Graph rendering and interaction model (click/hover, progressive expansion).
- Schema/caching (nodes, edges, evidence stored in edge metadata).
- Failure modes (ambiguity, generic outputs, recency) and mitigations (context-first classification; strict output schema; evidence requirement).

