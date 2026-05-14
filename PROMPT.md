# Constellations — Prompt

## Original idea

> I want to generate collaboration graphs of world history. The edges are people who have wikipedia pages. The nodes are things that bring people together: one-on-one meetings, projects, movies, battles, schools, and so on. I want to start with some node, like the movie Godfather, and follow the careers of the people who collaborated on it to other nodes. I want to see it as a graph and be able to wander around in the space.

## How it evolved

The first surprise was structural: people turned out to be nodes, not edges. A person is a hub of events; an event is a hub of persons. The edges connect people with the events they participated in — no person-to-person or event-to-event connections. This is the bipartite constraint that now governs the entire app.

An "event" is anything that involves at least two people at a given time or time range: a film, a battle, a school, a collaboration. The model is remarkably general — it works for movies, classical music, scientific papers, political movements, sports, anything where people gather around a shared thing.

The second key decision was laziness by design. No pre-built database. The whole graph exists nowhere until you explore it. The LLM constructs a local neighborhood on demand — slower than a static graph, but it works on anything with a Wikipedia presence.

## Technical spec

**Stack:** Vite + React + TypeScript. D3 for the force-directed graph layout (`forceSimulation`, `forceLink`, `forceManyBody`, `forceCenter`, collision detection, zoom/drag). Express cache server (port 4000) backed by PostgreSQL.

**Bipartite graph model:**
- **Atomic nodes** (circles): individual entities — Person, Actor, Director, Composer, Author…
- **Composite nodes** (squares): collections — Movie, Album, Battle, School, Paper…
- Every edge connects exactly one Atomic to one Composite. Atomic↔Atomic and Composite↔Composite edges are forbidden.
- `is_atomic: true` → circle, `is_atomic: false` → square.

**Session flow:**
1. User types a seed term (e.g., "The Godfather", "Stanley Kubrick", "Beethoven").
2. LLM classifies it as Atomic or Composite and selects the bipartite pair type for the session (e.g., Person↔Movie, Composer↔Symphony).
3. The pair type is locked for the session. Expanding a Person node yields its Movies; expanding a Movie yields its People.
4. Nodes expand on click. The graph grows outward from the seed.

**LLM routing:** Multiple providers supported — DeepSeek (default), Gemini, OpenAI, Anthropic. Provider is selected in the ControlPanel and persisted to localStorage. All AI calls go through the cache server; the browser sends `llmProvider` in every request body so the server honors the selection.

**Proxy / cache pattern:** All LLM calls go through `http://localhost:4000/api/ai/*`. The server checks PostgreSQL first; on miss, calls the LLM and caches the result. This makes repeat visits instant and limits API spend.

**Images:** Wikipedia Commons API, not the LLM. Each node gets a portrait or poster fetched by title.

**Constraints:** People and events must have Wikipedia pages. The LLM's knowledge is only as good as its training data — but Wikipedia coverage is broad enough that essentially any historically notable person or event works.
