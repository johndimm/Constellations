# Constellations — Dev Journal

## 2025-12-10 — 2025-12-15 — Genesis

### Dec 10 — first working version

Started the project on Dec 10. The core features were working that afternoon — the seed prompt was about generating collaboration graphs of world history, where people are edges and shared projects are nodes. Within hours of building it the mental model flipped: **people are nodes, not edges**. A person is a hub of events; an event is a hub of persons. The bipartite structure emerged from this insight and has governed the app ever since.

The "event" definition: anything involving at least two people at a given time or time range — a film, a battle, a school, a collaboration. The model turned out to be remarkably general.

The other core decision was **laziness by design**: no pre-built database. The whole graph exists nowhere until you explore it. The LLM constructs a local neighborhood on demand. Slower, but works on anything with a Wikipedia presence.

**Graph engine:** D3 force-directed layout — `forceSimulation`, `forceLink`, `forceManyBody`, `forceCenter`, collision detection, zoom/drag.

**Images:** Wikipedia Commons API (not the LLM — Cursor advised this would be too error-prone, and Commons coverage is good enough).

### Agent tool history

Started in **Google AI Studio** — great initial progress but pushed too far, took a wrong turn, and needed to revert a day's work. The agent was handling GitHub commits but couldn't revert to main. Escaped to **Antigravity** (fine until quota ran out), then **Cursor** (paid account — weakest link, many errors, finds best solutions only after exhausting all alternatives), then **Codex** (a step up, not cheap — but only ~$3 of work remained).

**Style note:** present the agent with problems, don't reveal the solution you have in mind. Let it find the path.

### Dec 15 — first public release

Posted for friends on Dec 15. Save/restore and export/import were still missing for graph sharing — added that same evening. Cursor doom-looped on it; finished in Codex.

Spent the rest of that week finding good examples, tweaking image queries, updating help, and playing.

---

## 2026-05-14

### Hub navigation
Added "Constellations" title as a hub home link (replaces the X close button in standalone mode). `index.tsx` passes `closeHref={VITE_HUB_URL}` to `<App>`, and `AppHeader.tsx` renders the title as an `<a>` when `closeHref` is set, with tooltip `"Film & Music — return to hub"`. Removed the X button from standalone since the title link serves that role.

### Multi-LLM support
Extended beyond Gemini to support DeepSeek, OpenAI, and Anthropic:
- `aiUtils.ts`: added `LlmProviderId`, `getBrowserLlmOverride`, `setBrowserLlmOverride`, `getLlmProvider`, `setServerLlmOverride`
- `aiService.ts`: rewritten as a provider dispatcher — reads `getLlmProvider()` at call time so switching providers in the UI takes effect immediately
- `deepseekService.ts`: repurposed as "alt LLM service" — routes to deepseek/openai/anthropic via `callAltLlm`; Anthropic uses a different API format (separate branch)
- `ControlPanel.tsx`: LLM dropdown selector persists selection to `localStorage`
- `server.ts`: each AI proxy endpoint now calls `applyProviderFromRequest(req)` → `setServerLlmOverride(provider)`, so the server honors the browser's selected LLM
- Every proxy request now includes `llmProvider` in the body

### Stanley Kubrick classification bug — root cause analysis

**Bug**: Kubrick was showing as type "Event" (square node) instead of Person (circle).

**Root cause chain** (three independent bugs all contributing):

1. **`...nodeData` spread order** (`useSearchHandlers.ts`): The DB had Kubrick cached as `type: "Event"` from a prior bad LLM response. The `startNode` object literal spread `...nodeData` *last*, silently overriding the fresh classification. Fix: spread `...nodeData` first, then set `type` and `is_atomic` explicitly.

2. **Stale expansion cache** (`useExpansion.ts`): Kubrick's cached expansion (from when he was an Event) contained actors. After his type was corrected to Person, the cache was reused unchanged. Fix: semantic consistency check — if cached children are mostly actor/person types but the bipartite structure expects composites (parent is now atomic), bypass the cache and force a fresh LLM call.

3. **LLM `is_atomic` overridden by DB** (`useExpansion.ts`): In the main expansion path, `cn.is_atomic` from the DB cache was used. The DB had stale values. Fix: save `freshAtomicByTitle` from `resultsWithWiki` *before* the cache fetch overwrites `nodesToUse`, and prefer those values in the final node render.

**Fixes applied** in: `useSearchHandlers.ts`, `useExpansion.ts`, and their copies in `film-and-music/packages/constellations/` and `film-and-music/apps/soundings/app/lib/constellations/`.

**DB cleared** after fixes: `curl -X DELETE http://localhost:4000/cache/clear` (1164 nodes, 1128 edges).

### Person-name heuristic
Added `looksLikePersonName(term)` to `aiUtils.ts`: 2–4 Title-Case words, no parens/digits, no leading article. Used in two places:
- `defaultStartPairResult(reason, term?)`: fallback classification defaults to `isAtomic: true, type: "Person"` for apparent person names instead of always `isAtomic: false, type: "Event"`
- Post-proxy sanity check in both `geminiService.ts` and `deepseekService.ts`: if proxy returns `isAtomic: false` for a term that looks like a person name, override it
