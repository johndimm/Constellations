"use client";
type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
  created?: { "date-parts"?: number[][] };
  URL?: string;
};

function clean(s?: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function yearFromParts(parts?: number[][]) {
  const y = parts?.[0]?.[0];
  return typeof y === "number" && Number.isFinite(y) ? y : undefined;
}

function bestYear(msg: CrossrefWork) {
  return yearFromParts(msg.published?.["date-parts"]) ?? yearFromParts(msg.created?.["date-parts"]);
}

function bestTitle(msg: CrossrefWork) {
  const t = msg.title?.[0];
  return clean(t);
}

function bestUrl(msg: CrossrefWork) {
  const doi = clean(msg.DOI);
  if (doi) return `https://doi.org/${doi}`;
  const u = clean(msg.URL);
  return u || undefined;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Crossref request failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

export async function fetchCrossrefWorkByDoi(doi: string): Promise<CrossrefWork | null> {
  const d = clean(doi).replace(/^https?:\/\/doi\.org\//i, "");
  if (!d) return null;

  // Prefer backend proxy (avoids CORS / rate-limit issues).
  const proxyUrl = `/api/crossref/work?doi=${encodeURIComponent(d)}`;
  try {
    const json = await fetchJson(proxyUrl);
    const msg: CrossrefWork | undefined = json?.message;
    return msg || null;
  } catch {
    // Fallback to direct Crossref if proxy isn't running.
    const directUrl = `https://api.crossref.org/works/${encodeURIComponent(d)}`;
    const json = await fetchJson(directUrl);
    const msg: CrossrefWork | undefined = json?.message;
    return msg || null;
  }
}

export function crossrefWorkToPaperNode(msg: CrossrefWork) {
  const title = bestTitle(msg) || "Untitled";
  const year = bestYear(msg);
  const venue = clean(msg["container-title"]?.[0] || "");
  const doi = clean(msg.DOI);
  const authors = (msg.author || [])
    .map(a => clean([a.given, a.family].filter(Boolean).join(" ")))
    .filter(Boolean);

  const descParts = [
    year ? `Published ${year}.` : "",
    venue ? `Venue: ${venue}.` : "",
    doi ? `DOI: ${doi}.` : "",
    authors.length ? `Authors: ${authors.slice(0, 8).join(", ")}${authors.length > 8 ? "…" : ""}` : ""
  ].filter(Boolean);

  return {
    title,
    type: "Paper",
    description: descParts.join(" "),
    year,
    is_atomic: false,
    meta: {
      doi: doi || undefined,
      crossrefUrl: bestUrl(msg),
      source: "crossref"
    }
  };
}

export function crossrefAuthors(msg: CrossrefWork) {
  return (msg.author || [])
    .map(a => clean([a.given, a.family].filter(Boolean).join(" ")))
    .filter(Boolean);
}

export function makeCrossrefAuthorshipEvidence(msg: CrossrefWork, authorName: string) {
  const paperTitle = bestTitle(msg) || "this paper";
  const snippet = `${clean(authorName) || "This author"} is listed as an author of "${paperTitle}" (Crossref metadata).`;
  return {
    kind: "crossref" as const,
    pageTitle: paperTitle,
    snippet,
    url: bestUrl(msg)
  };
}

