# Discussion & Future Work

## Discussion: what Constellations is (and is not)
Constellations is designed for **exploration**, not inference. While bipartite network analysis offers statistical models for affiliation data, Constellations operates in an open-world setting with locally constructed neighborhoods and focuses on user experience: recall, curiosity, and sensemaking.

## Limitations (draft)
- **Open-world ambiguity**: many entities have ambiguous names; disambiguation is imperfect.
- **Recency and knowledge gaps**: recent events may not be represented reliably without external context.
- **Evidence quality**: evidence snippets can be missing, weak, or not fully verifiable without additional checks.
- **Domain variance**: some domains are naturally “clean” bipartite graphs (films), while others are noisier (politics).

## Future work directions (draft)

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

### Global “map-like” exploration (joint embedding)
Inspired by joint displays of affiliation networks, a long-term direction is to place a very large two-mode graph into a shared 2D space (“knowledge cartography”), enabling map-like exploration at multiple zoom levels. A practical approach would require multi-resolution embeddings and approximate optimization rather than exact global minimization.

### Domain packs and curatorial modes
For domains like film and museums:
- curated constraints on allowed composite types,
- exhibit-specific “packs” with guided seeds and narratives,
- touch-screen / installation mode for public spaces.

### Scaling limits as a design probe
Bulk frontier expansion (e.g., expanding all leaf nodes repeatedly) provides a practical way to probe system limits: at what point do layout stability, latency, and evidence quality degrade? Characterizing this “interesting limit” could inform adaptive strategies such as multi-resolution views, clustering, and progressive summarization.

