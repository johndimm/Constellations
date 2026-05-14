"use client";
type OpenAlexWork = {
  id: string; // e.g. https://openalex.org/W...
  title?: string;
  display_name?: string;
  publication_year?: number;
  doi?: string | null; // usually "https://doi.org/..."
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string | null;
  };
  authorships?: Array<{
    author?: { id?: string; display_name?: string };
  }>;
};

type OpenAlexAuthor = {
  id: string; // e.g. https://openalex.org/A...
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
};

const BASE = "https://api.openalex.org";

function abstractFromInvertedIndex(ii?: Record<string, number[]>) {
  if (!ii) return "";
  const tokens: Array<{ w: string; pos: number }> = [];
  for (const [w, positions] of Object.entries(ii)) {
    for (const pos of positions || []) tokens.push({ w, pos });
  }
  tokens.sort((a, b) => a.pos - b.pos);
  // This is already tokenized; join with spaces.
  return tokens.map(t => t.w).join(" ").trim();
}

function clean(s?: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function bestWorkTitle(w: OpenAlexWork) {
  return clean(w.title || w.display_name || "");
}

function bestWorkUrl(w: OpenAlexWork) {
  const doi = clean(w.doi || "");
  if (doi) return doi;
  const landing = clean(w.primary_location?.landing_page_url || "");
  if (landing) return landing;
  const id = clean(w.id || "");
  return id || undefined;
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      // Be a good citizen; OpenAlex recommends a UA/mailto in production,
      // but keep it minimal here.
      Accept: "application/json"
    }
  });
  if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

// Simple in-memory caches (session-only)
const workSearchCache = new Map<string, OpenAlexWork | null>();
const authorSearchCache = new Map<string, OpenAlexAuthor | null>();
const workByIdCache = new Map<string, OpenAlexWork | null>();

export async function searchOpenAlexWork(query: string): Promise<OpenAlexWork | null> {
  const q = clean(query);
  if (!q) return null;
  if (workSearchCache.has(q)) return workSearchCache.get(q) || null;
  const url = `${BASE}/works?search=${encodeURIComponent(q)}&per-page=1`;
  const json = await fetchJson(url);
  const w: OpenAlexWork | undefined = json?.results?.[0];
  const out = w?.id ? w : null;
  workSearchCache.set(q, out);
  return out;
}

export async function searchOpenAlexAuthor(name: string): Promise<OpenAlexAuthor | null> {
  const q = clean(name);
  if (!q) return null;
  if (authorSearchCache.has(q)) return authorSearchCache.get(q) || null;
  const url = `${BASE}/authors?search=${encodeURIComponent(q)}&per-page=1`;
  const json = await fetchJson(url);
  const a: OpenAlexAuthor | undefined = json?.results?.[0];
  const out = a?.id ? a : null;
  authorSearchCache.set(q, out);
  return out;
}

export async function getOpenAlexWork(workIdOrUrl: string): Promise<OpenAlexWork | null> {
  const id = clean(workIdOrUrl);
  if (!id) return null;
  if (workByIdCache.has(id)) return workByIdCache.get(id) || null;
  const url = id.startsWith("http") ? id.replace("openalex.org/", "api.openalex.org/") : `${BASE}/works/${encodeURIComponent(id)}`;
  const w = (await fetchJson(url)) as OpenAlexWork;
  const out = w?.id ? w : null;
  workByIdCache.set(id, out);
  return out;
}

export async function getTopWorksForAuthor(authorIdOrUrl: string, limit = 10): Promise<OpenAlexWork[]> {
  const id = clean(authorIdOrUrl);
  if (!id) return [];
  // OpenAlex expects filter=authorships.author.id:<openalex_id>
  const filterId = id.startsWith("http") ? id : `https://openalex.org/${id}`;
  const url = `${BASE}/works?filter=authorships.author.id:${encodeURIComponent(filterId)}&sort=cited_by_count:desc&per-page=${Math.max(1, Math.min(25, limit))}`;
  const json = await fetchJson(url);
  const works: OpenAlexWork[] = Array.isArray(json?.results) ? json.results : [];
  return works.filter(w => !!w?.id);
}

export function openAlexWorkToPaperNode(work: OpenAlexWork) {
  const title = bestWorkTitle(work) || "Untitled";
  const year = work.publication_year;
  const venue = clean(work.primary_location?.source?.display_name || "");
  const abs = abstractFromInvertedIndex(work.abstract_inverted_index);
  const descParts = [
    year ? `Published ${year}.` : "",
    venue ? `Venue: ${venue}.` : "",
    abs ? abs : ""
  ].filter(Boolean);

  return {
    title,
    type: "Paper",
    description: descParts.join(" "),
    year: year ?? undefined,
    is_atomic: false,
    meta: {
      openAlexWorkId: work.id,
      doi: work.doi || undefined,
      openAlexUrl: work.id,
      source: "openalex"
    }
  };
}

export function openAlexAuthorToAuthorNode(author: OpenAlexAuthor) {
  const title = clean(author.display_name || "") || "Unknown Author";
  const descParts = [
    Number.isFinite(author.works_count) ? `${author.works_count} works (OpenAlex).` : "",
    Number.isFinite(author.cited_by_count) ? `${author.cited_by_count} citations (OpenAlex).` : ""
  ].filter(Boolean);
  return {
    title,
    type: "Author",
    description: descParts.join(" "),
    is_atomic: true,
    meta: {
      openAlexAuthorId: author.id,
      openAlexUrl: author.id,
      source: "openalex"
    }
  };
}

export function makeOpenAlexAuthorshipEvidence(work: OpenAlexWork, authorName: string) {
  const paperTitle = bestWorkTitle(work) || "this paper";
  const snippet = `${clean(authorName) || "This author"} is listed as an author of "${paperTitle}" (OpenAlex metadata).`;
  return {
    kind: "openalex" as const,
    pageTitle: paperTitle,
    snippet,
    url: bestWorkUrl(work)
  };
}

