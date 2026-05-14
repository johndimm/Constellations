"use client";
import { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

export interface GraphNode extends SimulationNodeDatum {
  id: number | string; // Sequential serial ID or Wikipedia/OpenAlex ID
  title: string; // The name of the event/project/thing/person
  type: string; // Original detailed type: 'Person', 'Movie', 'Battle', etc. (preserved)
  is_atomic?: boolean; // True for atomic nodes, false for composite nodes
  is_person?: boolean; // DEPRECATED: use is_atomic
  wikipedia_id?: string;
  description?: string;
  meta?: Record<string, any>; // Optional source-specific metadata (e.g., OpenAlex IDs)
  imageUrl?: string | null; // URL for the node image
  year?: number; // Year of occurrence (for timeline view)
  expanded?: boolean; // Whether we have already fetched connections for this node
  isLoading?: boolean; // Visual state for fetching (connections)
  fetchingImage?: boolean; // State for fetching image
  imageChecked?: boolean; // Whether we have already attempted to fetch an image
  wikiSummary?: string; // Cached Wikipedia summary for richer sidebar context
  classification_reasoning?: string; // AI explanation of atomic/composite status
  atomic_type?: string; // e.g. "Symptom"
  composite_type?: string; // e.g. "Disease"
  mentioningPageTitles?: string[]; // Titles of articles mentioning this entity (for non-article fallback)
  /** Measured card height in timeline view (set by Graph layout). */
  h?: number;
  // D3 Simulation properties explicitly defined to ensure access
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
  index?: number;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: number | string | GraphNode;
  target: number | string | GraphNode;
  id: string | number; // Unique link ID
  label?: string; // Role or connection description
  evidence?: {
    kind: 'wikipedia' | 'openalex' | 'crossref' | 'ai' | 'none';
    // Human-readable page title where the snippet came from (usually source or target)
    pageTitle?: string;
    // Copyable snippet (typically 1 sentence)
    snippet?: string;
    // URL to open for verification
    url?: string;
  };
}

export interface GeminiEntity {
  name: string;
  type: string;
  description: string;
  role: string; // Role in the parent connection
}

export interface GeminiPerson {
  name: string;
  wikipediaTitle?: string; // Canonical Wikipedia page title (may include disambiguation parentheses)
  role: string; // Role in the source node
  description: string; // Brief bio
  isAtomic?: boolean; // LLM-determined atomic vs composite classification
  evidenceSnippet?: string; // 1 sentence from provided verified text (preferred)
  evidencePageTitle?: string; // Which page the snippet came from (usually the source title)
}

export interface GeminiResponse {
  sourceYear?: number;
  people: GeminiPerson[];
}

export interface PersonWork {
  entity: string;
  wikipediaTitle?: string; // Canonical Wikipedia page title (may include disambiguation parentheses)
  type: string;
  description: string;
  role: string;
  year: number;
  imageUrl?: string | null;
  isAtomic?: boolean; // LLM-determined atomic vs composite classification
  evidenceSnippet?: string; // 1 sentence from provided verified text (preferred)
  evidencePageTitle?: string; // Which page the snippet came from (usually the source title)
}

export interface PersonWorksResponse {
  works: PersonWork[];
}

export interface PathEntity {
  id: string;
  type: string;
  description: string;
  year?: number;
  justification: string; // How it connects to the previous node
}

export interface PathResponse {
  path: PathEntity[];
  found: boolean;
}
