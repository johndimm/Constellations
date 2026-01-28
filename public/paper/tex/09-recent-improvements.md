## Recent Improvements and Deployment

### Chrome Extension

Constellations is now available as a **Chrome browser extension**, enabling exploration directly from Wikipedia pages. The extension provides:

- **Context menu integration**: Right-click any Wikipedia article to explore connections
- **Side panel interface**: Graph appears in Chrome's side panel, keeping the article visible
- **Seamless integration**: Same interaction model as the web app
- **Privacy-first design**: No personal data collection; only uses public Wikipedia content

The extension demonstrates that the bipartite exploration model works well in both standalone and embedded contexts.

### Improved Visual Feedback

Recent refinements to the graph visualization system include:

- **Smart link highlighting**: Links remain bright when connecting two highlighted nodes, improving visual clarity during expansion and path-finding
- **Consistent node selection**: Clicking a node highlights both the node and all its immediate neighbors
- **Better image resolution**: Improved portrait selection for actors, musicians, and other person types using prioritized Wikipedia/Wikidata/Commons search

These changes reduce cognitive load during exploration and make the graph's structure more immediately apparent.

### URL-Based Sharing

The application now supports **shareable URLs** via query parameters (e.g., `?q=Kevin+Bacon`). This enables:

- **Direct access**: URLs start exploration from a specific entity automatically
- **Lightweight sharing**: Share interesting starting points without saving full graphs
- **Cross-platform**: Works in both web app and Chrome extension

This aligns with the low-friction exploration philosophy—users can share a starting point with a single URL copy.

### Simplified Control Panel

To reduce visual clutter, the control panel now features **collapsible sections**:

- **Examples section**: Domains and starter terms hidden by default
- **Single toggle**: One button controls visibility of both DOMAINS and START HERE lists
- **Cleaner interface**: Reduces overwhelm for new users while keeping power features accessible

This represents an ongoing effort to balance feature richness with approachability.

### Data Handling and Privacy

With the Chrome extension release, explicit **privacy policies** were established:

- **No personal data collection**: The system does not track users or collect browsing history
- **Local storage only**: User preferences and saved graphs stay on device
- **Anonymous caching**: Server-side caching contains only public graph data with no user identifiers
- **Clear permissions**: All extension permissions justified with specific use cases

This transparency supports trust in an exploratory system that accesses web content and makes network requests.
