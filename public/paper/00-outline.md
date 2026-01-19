# Constellations: Low-Friction Exploratory Navigation with Evidence-Backed Bipartite Graphs (Draft)

## Working title candidates
- **Constellations: Low-Friction Exploratory Navigation with Evidence-Backed Bipartite Graphs**
- **Low-Friction Branching Exploration with Atomic↔Composite Graphs**
- **A Bipartite Interface for Open-World Knowledge Exploration**

## One-sentence pitch
Constellations is an interactive system for **low-friction, branching exploration** that constructs **bipartite (Atomic↔Composite)** graphs on demand from natural-language queries and attaches **edge evidence** to support interpretability during exploration.

## Core framing
- **Problem**: People often explore knowledge for recall, curiosity, and discovery—not just to answer a single query. Search and static KGs under-serve fast, low-commitment **try/backtrack** exploration.
- **Idea**: Use a **bipartite alternation constraint** (Atomic↔Composite) as a stable interaction primitive across domains, and build the graph **locally/on demand**.
- **Trust**: Show “why” with **evidence-backed edges** (snippet + source link).
- **Outcome**: The interface makes the **frontier of the user’s knowledge** visible and explorable.

## Claims (draft)
- **C1 (interaction model)**: Bipartite alternation provides a simple, domain-general interaction model for exploratory graph expansion.
- **C2 (open-world graph construction)**: Using an LLM to propose neighbors while enforcing bipartite structure enables rapid cross-domain exploration without a prebuilt KG.
- **C3 (evidence-backed edges)**: Attaching evidence to edges improves interpretability and helps users decide what to trust and where to expand next.

## Contributions (draft)
- **System**: A working interactive graph explorer that supports a small set of Atomic↔Composite pairs and **locks the pair per session** (chosen from the first query) to prevent mid-graph switching.
- **Design**: A design rationale for bipartite alternation as an exploration constraint (“events as meetings” generalized).
- **Evidence UI**: Edge-level evidence display as a first-class interaction.

## Research questions (draft)
- **RQ1**: How does a bipartite alternation constraint affect users’ ability to explore quickly (try/backtrack) without getting lost?
- **RQ2**: Does edge evidence improve trust and decision-making about what to explore next?
- **RQ3**: What kinds of “frontier” experiences (recall, surprise, gaps) do users report when using Constellations?

## Scope / non-goals
- Not a recommender system trained on private user logs.
- Not claiming causal inference or sociological conclusions from the graph.
- Prioritizes exploration and interpretability over global completeness.

