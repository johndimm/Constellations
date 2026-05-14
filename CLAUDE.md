# Constellations — Claude Code Guide

## What this is

**Constellations** is a Vite/React app that builds live AI-powered bipartite knowledge graphs. The user types a seed term; an LLM classifies it as Atomic (Person, Author…) or Composite (Movie, Album, Event…) and expands the graph outward. The bipartite pair is locked for the entire session.

## Running locally

```bash
# Terminal 1 — cache/proxy server (PostgreSQL + AI proxy endpoints)
npm run start:cache        # http://localhost:4000

# Terminal 2 — Vite dev server
npm run dev                # http://localhost:3001
```

Both must be running. The browser talks to the cache server for all AI calls (proxy pattern).

## Key architecture

### Bipartite structure
- **Atomic nodes** (circles): individual entities — Person, Actor, Author, Director, Composer…
- **Composite nodes** (squares): collections — Movie, Album, Event, Paper…
- All edges connect an Atomic to a Composite. Never Atomic↔Atomic or Composite↔Composite.
- `is_atomic: true` → circle, `is_atomic: false` → square.

### LLM routing
`services/aiService.ts` dispatches all LLM calls:
- `"gemini"` → `geminiService.ts` (Google GenAI, structured JSON schema output)
- `"deepseek"` / `"openai"` / `"anthropic"` → `deepseekService.ts` (handles all three via `callAltLlm`)

Provider is read from:
1. `localStorage["constellations_llm_provider"]` (browser UI selector in ControlPanel)
2. `VITE_AI_PROVIDER` env var
3. Default: `"deepseek"`

When the browser calls the proxy server, it sends `llmProvider` in the request body. The server calls `setServerLlmOverride(provider)` before each AI endpoint call so the server-side LLM matches the browser selection.

### Proxy pattern
When `VITE_CACHE_URL` is set (always in dev, points to `http://localhost:4000`):
- All AI calls go through the cache server (`/api/ai/classify-start`, `/api/ai/classify`, `/api/ai/connections`, `/api/ai/works`, `/api/ai/path`, `/api/ai/title`)
- The server checks its PostgreSQL cache first, then calls the LLM
- `shouldProxy()` → true in browser when `VITE_CACHE_URL` is set

### Key env vars (`.env.local`)
```
VITE_CACHE_URL=http://localhost:4000
VITE_GEMINI_API_KEY=...
VITE_GEMINI_MODEL=gemini-2.5-pro
VITE_DEEPSEEK_API_KEY=...
VITE_OPENAI_API_KEY=...
VITE_ANTHROPIC_API_KEY=...
VITE_HUB_URL=http://127.0.0.1:8000   # link back to Soundings hub
```

## Common pitfalls

### Node type priority — spread order matters
When constructing a `GraphNode` from DB data + fresh classification, always spread DB data FIRST:
```typescript
const node: GraphNode = {
    ...nodeData,       // DB record FIRST — provides id, image_url, etc.
    type,              // fresh classification WINS
    is_atomic: isAtomic,
    ...
};
```
If `...nodeData` is last, the DB's stale `type`/`is_atomic` silently overrides the fresh result.

### Expansion `is_atomic` — trust LLM, not DB cache
When building child nodes after expansion, the DB-cached `is_atomic` can be stale. Before fetching from cache, save the LLM-returned values:
```typescript
const freshAtomicByTitle = new Map(
    resultsWithWiki
        .filter(cn => typeof cn.is_atomic === 'boolean')
        .map(cn => [cn.title.toLowerCase(), cn.is_atomic])
);
// Later, in setGraphData:
is_atomic: freshAtomicByTitle.get(cn.title.toLowerCase()) ?? expectedChildIsAtomic,
```

### Stale expansion cache
The early-return cache path checks if cached children's types match the expected bipartite role. If Kubrick was cached as an Event (children = actors), but is now a Person (children should = movies), the cache is bypassed automatically.

### Clearing the DB
```bash
curl -X DELETE http://localhost:4000/cache/clear
```
Safe to run any time. Forces all expansions to re-fetch from the LLM.

## File map

| File | Purpose |
|------|---------|
| `services/aiService.ts` | Provider dispatcher — reads `getLlmProvider()` at call time |
| `services/aiUtils.ts` | Shared utilities: env reading, retry, `getLlmProvider`, `setServerLlmOverride`, `looksLikePersonName` |
| `services/geminiService.ts` | Gemini LLM implementation + `defaultStartPairResult` |
| `services/deepseekService.ts` | DeepSeek / OpenAI / Anthropic implementation |
| `hooks/useSearchHandlers.ts` | Handles search input → `classifyStartPair` → initial node |
| `hooks/useExpansion.ts` | Handles node expansion → `fetchPersonWorks` / `fetchConnections` |
| `components/ControlPanel.tsx` | Settings panel including LLM selector dropdown |
| `server.ts` | Express cache/proxy server (port 4000) |
| `index.tsx` | Standalone entry — passes `closeHref={VITE_HUB_URL}` to `<App>` |
