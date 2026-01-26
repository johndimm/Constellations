# Chrome Web Store Submission Guide

This document outlines the steps to submit the Constellations extension to the Chrome Web Store.

## 1. Prepare the ZIP Bundle
First, generate the production bundle for the extension.

```bash
npm run bundle:ext
```
This will create `constellations-extension.zip` in your project root.

## 2. Chrome Developer Dashboard
1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Click **+ New Item**.
3. Upload the `constellations-extension.zip` file.

## 3. Store Listing Assets
You will need to provide the following visual assets for the store listing:

### Screenshots
- Provide at least 2 screenshots (1280x800 or 640x400).
- Show the **Network** view and the **Timeline** view within the sidepanel.

### Promotional Tiles
- **Small Tile (Required)**: 440 x 280
- **Large Tile**: 920 x 680
- **Marquee Tile**: 1400 x 560

## 4. Submission Details

### Description
**Constellations** is an AI-powered research tool that helps you visualize the complex web of history, science, and culture. By transforming raw information into interactive bipartite graphs, it reveals hidden patterns and chronological paths between people and their works.

*Key Features:*
- **Interactive Knowledge Graphs**: Explorer how entities are connected through a dynamic, force-directed network.
- **Chronological Timelines**: Pivot from a network view to a structured timeline to see the evolution of a subject's life and work.
- **One-Click Expansion**: Deep dive into any topic; Constellations uses AI to find the most relevant connections from across the web.
- **Wikipedia Grounding**: Every node is backed by real-world data and linked to official Wikipedia entries for quick verification.

### Privacy Policy Summary
Constellations is committed to user privacy. We do not track your browsing history or collect personal information. 
- **Data Usage**: When you choose to "Expand" a topic, the node title and limited context are sent to our secure AI proxy to generate graph connections.
- **Zero Tracking**: We do not use persistent identifiers or share any user data with third parties.

### Single Purpose Statement
"To provide an AI-powered knowledge exploration interface that visualizes connections between entities through interactive bipartite graphs."

## 5. Review Process
- Distribution to the store typically takes a few days. 
- Ensure your backend (`constellations-beaf.onrender.com`) is running and stable during the review.
