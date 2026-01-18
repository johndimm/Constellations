# Introduction

People often explore knowledge not to answer a single query, but to follow curiosity across many possible directions with minimal commitment: expand something, see what appears, and backtrack quickly to try a different branch. We call the boundary this process reveals the **knowledge frontier**—the set of adjacent ideas that are reachable from a current concept but not yet part of one’s active memory. Interfaces for search, browsing, and encyclopedic reading support directed lookup, but can be less suited to this low-friction, branching process of “what else is nearby?” where the cost of trying a path is intentionally small.

Constellations is designed for this mode. Starting from a single user-provided entity, the system constructs a small, local graph and supports repeated **expand** operations that reveal additional connected entities. The key design decision is to enforce a **bipartite alternation constraint**: nodes alternate between **Atomic** entities (individuals or elementary concepts) and **Composite** entities (events, works, groups, conditions, or other aggregations). This constraint yields a stable interaction model across domains: atomic nodes are expanded into composites, and composites into atomics. In the project’s origin domain—history—this corresponds to a simple idea closely aligned with event-centric cultural heritage modeling: **events as “meetings”** that bring multiple people together. We generalize this to other domains (e.g., films: people↔movies; cooking: ingredients↔recipes; medicine: symptoms↔diseases) without changing the core UI.

Because the system operates in open-world settings and aims for broad domain coverage, Constellations uses a large language model (LLM) to propose candidate neighbors during expansion. However, exploratory systems that rely on generative models face an immediate interpretability challenge: users naturally ask **why** a connection exists before deciding whether it is worth pursuing. To address this, Constellations attaches **edge evidence**: short evidence snippets and source links displayed when an edge is selected. Evidence is treated as support for interpretation and verification, not as proof of causal claims.

This paper contributes an interactive exploration system and a design framing for bipartite low-friction exploration. We position Constellations relative to two-mode/affiliation networks and event-centric modeling, and we outline an evaluation plan centered on recall, discovery, and sensemaking.

## Contributions
- **A bipartite exploration interface** that enforces Atomic↔Composite alternation as a domain-general interaction primitive for click-to-expand exploration.
- **A session-level locking mechanism for bipartite pair selection**: the system chooses an Atomic↔Composite pairing from the first query and locks it for the session to reduce mid-graph “ontology drift.”
- **A kiosk-first interaction mode** (no typing) designed for touch displays, where users start from curated seeds and drive exploration by tapping.
- **Evidence-backed edges** that make edge inspection a first-class interaction via short snippets and source links.
- **An LLM-assisted, on-demand graph construction pipeline** that builds local neighborhoods without requiring a precomputed knowledge graph.
- **An evaluation plan** targeting exploration outcomes (recall, discovery, orientation, and trust), rather than accuracy alone.

## Why films are an especially good domain (informal motivation)
Many domains contain bipartite structure, but films provide a particularly clean and rewarding instance: people↔works with high-quality public metadata, stable naming, and strong Wikipedia coverage. This makes it easy to generate meaningful expansions (directors, co-stars, producers; films in a person’s oeuvre) and to attach interpretable evidence. In contrast, domains like current politics are both more dynamic and more sensitive; they require stricter evidence policies and careful treatment of ambiguity and recency.

