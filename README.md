# 🌌 Constellations

**Dynamic, AI-powered knowledge graphs of people and events.**

[![Hacker News](https://img.shields.io/badge/Hacker%20News-Show%20HN-orange)](https://news.ycombinator.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[Live Demo](https://constellations-delta.vercel.app/)** | **[LinkedIn Post](https://www.linkedin.com/feed/update/urn:li:activity:7409328608910946304/)**

<div align="center">
<video src="https://github.com/user-attachments/assets/8c9fb0b0-967e-4285-a71c-c922de8b245a" width="100%" controls autoplay muted></video>
</div>

## The Original Prompt

> I want to generate collaboration graphs of world history. The edges are people who have wikipedia pages. The nodes are things that bring people together: one-on-one meetings, projects, movies, battles, schools, and so on. I want to start with some node, like the movie Godfather, and follow the careers of the people who collaborated on it to other nodes. I want to see it as a graph and be able to wander around in the space.

## Philosophy & Design

The core idea was to be lazy: create collaboration graphs on the fly with **zero pre-computed database**. The whole graph exists nowhere until you start exploring. It constructs a local neighborhood around a given node using live LLM queries and expands outward from there.

### The Bipartite Realization
Early in development, I realized that people are **nodes**, not edges. 
- A **Person** is a hub of events.
- An **Event** (defined as anything involving at least 2 people) is a hub of persons.
- **Edges** only connect people with the events they participated in. 

There are strictly **no people-to-people or event-to-event connections**. This structure prevents the "hallucinated friendships" common in flat LLM queries and forces a historical logic onto the graph.

![The Godfather and Marlon Brando](public/godfather-brando.png)

## Vibe Coding: The Journey

This project was 100% "vibe coded" from start to finish—presenting problems to AI agents and iterating on their solutions. The journey took me through the current landscape of AI development tools:

1.  **Google AI Studio**: A great start, but I pushed it too far and it took a wrong turn. When it couldn't revert a day's worth of work, I had to "liberate" the project.
2.  **Antigravity**: My second stop, which worked well until I hit my quota.
3.  **Cursor**: Where I spent the bulk of the time. It’s a powerful tool but occasionally the "weakest link"—prone to doom loops and finding the best solution only after exhausting every possible alternative.
4.  **Codex**: When Cursor stalled on complex save/restore and export/import logic, Codex stepped in to finish the job. It was a step up in logic, though not cheap!

**Methodology**: I tried to present the agents with problems and kept my own implementation ideas to myself until I saw what they came up with. I've learned that the "Aha!" moment often comes from the agent's alternative path.

## Key Views

### Network & Timeline
The graph engine is built on **D3.js**, using a custom force-directed layout (`forceSimulation`, `forceLink`, `forceManyBody`, `forceCenter`, and collision detection). You can switch between the network view and a chronological timeline with one click.

![Godfather Timeline View](public/godfather-timeline.png)

### Path-seeking
Trace connections across history. Here is a path from **John von Neumann** to **Geoffrey Hinton**:

![John von Neumann to Geoffrey Hinton](<public/John Von Neumann to Geoffrey Hinton.png>)

### Browse People
For inspiration, I scored the 5,000 "top" biographies from Simple Wikipedia based on log article length and link density. It's a fascinating, if occasionally quirky, cross-section of world history.

![Browse People](public/people.png)

## Technical Architecture

- **Live Queries**: Uses **Gemini Pro** to identify connections on the fly.
- **Image Logic**: Currently queries **Wikipedia Commons** for images rather than the LLM (which the agents claimed would be too error-prone, though the current way has its own quirks!).
- **Persistence**: Saved graphs and LLM responses are cached in a **PostgreSQL (Supabase)** database to reduce tokens and speed up recurring paths.
- **Frontend**: React 19 + Tailwind CSS.

## Getting Started

1. **Clone & Install**:
   ```bash
   git clone https://github.com/johndimm/Constellations.git
   cd Constellations
   npm install
   ```

2. **Setup Env**:
   Create a `.env` file with your Gemini API key and Supabase URL.
   ```env
   VITE_GEMINI_API_KEY=your_key_here
   DATABASE_URL=your_postgres_url
   ```

3. **Run**:
   ```bash
   npm run start:cache  # Starts the backend (cache/db)
   npm run dev          # Starts the frontend
   ```

---

*Built with ❤️ and a small army of AI agents.*
