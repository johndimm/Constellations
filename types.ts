import { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

export interface GraphNode extends SimulationNodeDatum {
  id: string; // The unique name of the event/project/thing/person
  type: string; // 'Person', 'Movie', 'Battle', etc.
  description?: string;
  imageUrl?: string | null; // URL for the node image
  year?: number; // Year of occurrence (for timeline view)
  expanded?: boolean; // Whether we have already fetched connections for this node
  isLoading?: boolean; // Visual state for fetching (connections)
  fetchingImage?: boolean; // State for fetching image
  imageChecked?: boolean; // Whether we have already attempted to fetch an image
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
  source: string | GraphNode;
  target: string | GraphNode;
  id: string; // Unique link ID
  label?: string; // Role or connection description
}

export interface GeminiEntity {
  name: string;
  type: string;
  description: string;
  role: string; // Role in the parent connection
}

export interface GeminiPerson {
  name: string;
  role: string; // Role in the source node
  description: string; // Brief bio
  relatedNodes: GeminiEntity[];
}

export interface GeminiResponse {
  sourceYear?: number;
  people: GeminiPerson[];
}

export interface PersonWork {
  entity: string;
  type: string;
  description: string;
  role: string;
  year: number;
  imageUrl?: string | null;
}

export interface PersonWorksResponse {
  works: PersonWork[];
}