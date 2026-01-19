# Evaluation (Plan for a First Study)

This section outlines a mixed-method evaluation aligned with **low-friction, branching exploration** rather than accuracy alone. The goal is to evaluate whether Constellations supports recall, discovery, and sensemaking in a way that is difficult to capture with conventional “answer correctness” metrics.

## Study 1: Task-based user study (qual + quant)
### Goal
Measure whether Constellations helps users:
- recall forgotten related entities,
- discover new adjacent entities,
- maintain orientation during rapid branching and backtracking,
- and assess connections using evidence.

### Participants
- Mixed expertise: casual users + a small number of domain enthusiasts (e.g., film history or music).
- Target N=12–20 for an initial formative study; optional follow-up N=30+ for confirmatory comparisons.

### Tasks (examples)
- **Recall**: “Start from a film/person you know. Find 5 related items you had forgotten you knew.”
- **Discovery**: “Find 3 new films you want to watch next; explain why.”
- **Frontier navigation**: “Keep expanding until you hit a boundary where you no longer recognize most nodes; describe what you found.”
- **Evidence use**: “Given a surprising edge, use the evidence panel to decide whether you trust it enough to expand further.”
- **Kiosk interaction (optional)**: “Using only taps (no typing), start from curated seeds and build a small ‘story’ of 8–12 nodes you would show someone else.”

### Conditions (ablation)
- With vs without **edge evidence** (hide evidence panel).
- With vs without **bipartite enforcement** (optional, if a safe relaxed mode exists) or compare to a baseline interface (e.g., search + Wikipedia navigation).
- With vs without **session-level pair locking** (when multiple pairs are enabled): measure whether locking reduces user-reported confusion and drift.

### Measures
- Task completion (time, steps/expansions, backtracks).
- Self-reported recall/discovery (Likert + short explanations).
- Perceived orientation (NASA-TLX subset or simpler “I felt lost” scale).
- Evidence interaction frequency (edge clicks, “open source” clicks).
- Neighborhood quality proxies: duplicate rate, generic-node rate, and fraction of expansions producing ≥k meaningful neighbors.

### Qualitative prompts (examples)
- “Describe a moment where you changed direction quickly—what triggered it?”
- “Describe a moment where an edge’s evidence changed your decision to explore further.”
- “What did the system surface that you felt was ‘on the edge’ of your memory?”
- “Did you notice the Atomic↔Composite alternation? Did it help you predict what would happen when you clicked?”

## Study 2: Log-based / offline quality evaluation
### Goal
Assess properties of generated neighborhoods without claiming “truth”:
- **Named-entity quality** (avoid generic phrases).
- **Diversity** (avoid near-duplicates).
- **Evidence availability** (fraction of edges with evidence snippets).
- **Stability under repeated use** (cache hits; consistency of expansions for the same seed).

### Sample design
Select a set of seeds across domains (films prioritized), run multiple expansions, and evaluate with:
- rater checks (human annotation),
- plus simple structural metrics (degree distributions; repetition).

## Reporting “knowledge frontier”
One paper-specific contribution could be operationalizing the “frontier”:
- Track the point during exploration where a participant reports low recognition.
- Quantify as a function of depth/expansions and node familiarity labels.

## Analysis plan (lightweight)
- Use within-subject comparisons where possible (evidence on/off; lock on/off), counterbalanced across participants.
- Quantitative: paired tests on time/steps/backtracks and Likert outcomes; report effect sizes with confidence intervals.
- Qualitative: thematic analysis of “frontier” moments, evidence-driven decisions, and breakdowns (ambiguity, drift, low-signal expansions).