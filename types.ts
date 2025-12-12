import { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

export interface GraphNode extends SimulationNodeDatum {
  id: string; // The unique name of the event/project/thing
  type: string; // e.g., 'Movie', 'Battle', 'School'
  description?: string;
  imageUrl?: string | null; // URL for the node image
  expanded?: boolean; // Whether we have already fetched connections for this node
  isLoading?: boolean; // Visual state for fetching (connections)
  fetchingImage?: boolean; // State for fetching image
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
  person: string; // The person connecting the nodes
  role: string; // What they did (e.g., Director, General)
  id: string; // Unique link ID
  imageUrl?: string | null; // URL for the person image
  fetchingImage?: boolean; // State for fetching image
  isExpanding?: boolean; // Visual state for fetching more works by this person
}

export interface GeminiConnection {
  personName: string;
  personRole: string;
  connectedEntity: string;
  connectedEntityType: string;
  entityDescription: string;
}

export interface GeminiResponse {
  connections: GeminiConnection[];
}

export interface PersonWorksResponse {
  works: {
    entity: string;
    type: string;
    description: string;
    role: string;
  }[];
}