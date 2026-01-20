# Discussion & Future Work

## Discussion: what Constellations is (and is not)
Constellations is designed for **exploration**, not inference. While bipartite network analysis offers statistical models for affiliation data, Constellations operates in an open-world setting with locally constructed neighborhoods and focuses on user experience: recall, curiosity, and sensemaking.

## LLM use case: connection discovery, not text generation
An important distinction about the role of AI in Constellations: **we are not using the LLM to write text for the user**. That is typically the primary concern people have about AI systems—generated content that may be misleading, biased, or fabricated. Instead, Constellations uses the LLM to **find connections** between entities.

This is conceptually very similar to how a search engine works: in response to a query, the search engine returns a series of links to documents, and some of them may not be relevant. Users are already accustomed to this pattern and have developed effective strategies for handling it—they simply skip over the irrelevant results and focus on the useful ones. The cognitive load and trust calibration required are familiar and manageable.

In our application, irrelevant connections may occasionally appear in the graph. This should not be viewed as a catastrophic failure, but rather as an expected characteristic of exploratory retrieval systems. Users can quickly assess connection relevance through the attached evidence snippets and either dismiss spurious edges or follow promising ones. The interaction model naturally supports this filtering behavior without imposing undue burden.

## Limitations
- **Open-world ambiguity and name collisions**: many entities share names (e.g., people vs works with the same title). Lightweight context helps, but disambiguation remains imperfect and can propagate errors into expansion.
- **Model knowledge gaps and recency**: LLMs can be outdated, and Wikipedia coverage varies; the system can misclassify entities or miss important neighbors without stronger retrieval and verification.
- **Evidence is supportive, not definitive**: a single snippet and link is often enough for user judgment, but it does not guarantee the edge is correct. Automated snippet verification and multi-source provenance are not yet implemented.
- **Domain variance**: some domains naturally form clean affiliation structures (e.g., actors↔films), while others exhibit weaker “membership” semantics or higher noise. Session-level pair locking reduces drift but can also constrain legitimate cross-type exploration.
- **Scalability and layout stability**: force-directed layouts are effective for small local neighborhoods but can become unstable or visually dense under repeated bulk expansion, motivating multi-resolution views and clustering.

## Future work directions

### Better expansion ranking (bipartite-aware)
Use bipartite-inspired heuristics for ranking and diversity:
- down-weight generic hubs,
- promote diversity across roles/decades/types,
- rank by evidence quality and specificity.

### Stronger evidence and provenance
Move from “one snippet” to richer provenance:
- multiple evidence items per edge,
- automated verification that the snippet exists in the claimed source,
- user feedback loops (confirm/reject edges).

### Pair learning and “soft locks”
The current system chooses among a small set of bipartite pairs and locks the choice for the session. A natural extension is to treat pair selection as a probabilistic belief state: maintain a small set of candidate pairings with confidence, allow controlled switching only when confidence crosses a threshold, and preserve previously drawn edges by freezing node partitions once placed.

### Global “map-like” exploration (joint embedding)
Inspired by joint displays of affiliation networks, a long-term direction is to place a very large two-mode graph into a shared 2D space (“knowledge cartography”), enabling map-like exploration at multiple zoom levels. A practical approach would require multi-resolution embeddings and approximate optimization rather than exact global minimization.

### Domain packs and curatorial modes
For domains like film and museums:
- curated constraints on allowed composite types,
- exhibit-specific “packs” with guided seeds and narratives,
- touch-screen / installation mode for public spaces.

### Scaling limits as a design probe
Bulk frontier expansion (e.g., expanding all leaf nodes repeatedly) provides a practical way to probe system limits: at what point do layout stability, latency, and evidence quality degrade? Characterizing this “interesting limit” could inform adaptive strategies such as multi-resolution views, clustering, and progressive summarization.

