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
- Mixed expertise: casual users + a small number of domain enthusiasts (e.g., film).

### Tasks (examples)
- **Recall**: “Start from a film/person you know. Find 5 related items you had forgotten you knew.”
- **Discovery**: “Find 3 new films you want to watch next; explain why.”
- **Frontier navigation**: “Keep expanding until you hit a boundary where you no longer recognize most nodes; describe what you found.”
- **Evidence use**: “Given a surprising edge, use the evidence panel to decide whether you trust it enough to expand further.”

### Conditions (ablation)
- With vs without **edge evidence** (hide evidence panel).
- With vs without **bipartite enforcement** (optional, if a safe relaxed mode exists) or compare to a baseline interface (e.g., search + Wikipedia navigation).

### Measures
- Task completion (time, steps/expansions, backtracks).
- Self-reported recall/discovery (Likert + short explanations).
- Perceived orientation (NASA-TLX subset or simpler “I felt lost” scale).
- Evidence interaction frequency (edge clicks, “open source” clicks).

### Qualitative prompts (examples)
- “Describe a moment where you changed direction quickly—what triggered it?”
- “Describe a moment where an edge’s evidence changed your decision to explore further.”
- “What did the system surface that you felt was ‘on the edge’ of your memory?”

## Study 2: Log-based / offline quality evaluation
### Goal
Assess properties of generated neighborhoods without claiming “truth”:
- **Named-entity quality** (avoid generic phrases).
- **Diversity** (avoid near-duplicates).
- **Evidence availability** (fraction of edges with evidence snippets).

### Sample design
Select a set of seeds across domains (films prioritized), run multiple expansions, and evaluate with:
- rater checks (human annotation),
- plus simple structural metrics (degree distributions; repetition).

## Reporting “knowledge frontier”
One paper-specific contribution could be operationalizing the “frontier”:
- Track the point during exploration where a participant reports low recognition.
- Quantify as a function of depth/expansions and node familiarity labels.

