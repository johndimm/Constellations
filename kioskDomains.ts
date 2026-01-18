export type KioskDomain = {
  id: string;
  label: string;
  description?: string;
  // NOTE: The bipartite pair should be assigned by the LLM.
  // We keep this optional field only for backwards-compatibility with older saved configs,
  // but the client does not use it to force a pair.
  lockPair?: { atomicType: string; compositeType: string };
  terms: string[];
};

export const DEFAULT_KIOSK_DOMAINS: KioskDomain[] = [
  {
    id: "universal",
    label: "Universal (unlocked)",
    description: "Any domain. Allows interesting cross-domain jumps, but can drift into odd abstractions.",
    terms: [
      "Michelangelo",
      "Johann Sebastian Bach",
      "LeBron James",
      "sore throat",
      "Beef",
      "John von Neumann",
      "The Godfather"
    ]
  },
  {
    id: "mathematicians",
    label: "Mathematics",
    description: "Mostly mathematicians (people), plus a few foundational ideas.",
    terms: [
      "Paul Erdős",
      "Euclid",
      "Archimedes",
      "Isaac Newton",
      "Leonhard Euler",
      "Carl Friedrich Gauss",
      "Bernhard Riemann",
      "David Hilbert",
      "Emmy Noether",
      "Henri Poincaré",
      "Alan Turing",
      "Kurt Gödel",
      "John von Neumann",
      "Andrew Wiles",
      "Srinivasa Ramanujan"
    ]
  },
  {
    id: "actors-movies-tv",
    label: "Actors / Movies / TV",
    description: "People ↔ Works (films / TV).",
    terms: [
      "The Godfather",
      "Al Pacino",
      "Marlon Brando",
      "Scarface (1983 film)",
      "The Lord of the Rings (film series)",
      "Peter Jackson",
      "The Matrix",
      "Keanu Reeves",
      "Breaking Bad",
      "Better Call Saul",
      "The Sopranos",
      "Hayao Miyazaki",
      "Spirited Away"
    ]
  },
  {
    id: "popular-music",
    label: "Popular Music",
    description: "Artists, albums, and songs.",
    terms: [
      "Giant Steps",
      "Miles Davis",
      "Kind of Blue",
      "The Beatles",
      "Abbey Road",
      "Beyoncé",
      "Taylor Swift",
      "Radiohead",
      "Kendrick Lamar",
      "Prince",
      "David Bowie",
      "Daft Punk",
      "Discovery (Daft Punk album)"
    ]
  },
  {
    id: "classical-music",
    label: "Classical Music",
    description: "Composers/Performers ↔ Compositions.",
    terms: [
      "Ludwig van Beethoven",
      "Wolfgang Amadeus Mozart",
      "Johann Sebastian Bach",
      "Pyotr Ilyich Tchaikovsky",
      "Frédéric Chopin",
      "Igor Stravinsky",
      "The Rite of Spring",
      "The Magic Flute",
      "Symphony No. 5 (Beethoven)",
      "Goldberg Variations"
    ]
  },
  {
    id: "history",
    label: "History",
    description: "People ↔ Events.",
    terms: [
      "Napoleon Bonaparte",
      "French Revolution",
      "Watergate scandal",
      "Apollo 11",
      "Wright brothers",
      "First flight (Wright brothers)",
      "John von Neumann",
      "Geoffrey Hinton",
      "Renaissance"
    ]
  },
  {
    id: "science",
    label: "Science",
    description: "Scientists ↔ Discoveries/Experiments (safe, high-signal).",
    terms: [
      "Marie Curie",
      "radioactivity",
      "Albert Einstein",
      "general relativity",
      "Charles Darwin",
      "On the Origin of Species",
      "Gregor Mendel",
      "Mendelian inheritance",
      "Rosalind Franklin",
      "DNA",
      "CRISPR",
      "James Watson",
      "Francis Crick"
    ]
  },
  {
    id: "technology",
    label: "Technology",
    description: "Inventors/Researchers ↔ Inventions/Systems.",
    terms: [
      "Internet",
      "World Wide Web",
      "Tim Berners-Lee",
      "Alan Turing",
      "Turing machine",
      "Unix",
      "Linux",
      "Linus Torvalds",
      "C programming language",
      "Dennis Ritchie",
      "TCP/IP",
      "Vint Cerf",
      "Claude Shannon",
      "information theory"
    ]
  },
  {
    id: "art",
    label: "Art",
    description: "Artists ↔ Artworks/Movements.",
    terms: [
      "Michelangelo",
      "David (Michelangelo)",
      "Sistine Chapel ceiling",
      "Leonardo da Vinci",
      "Mona Lisa",
      "Vincent van Gogh",
      "The Starry Night",
      "Pablo Picasso",
      "Guernica (Picasso)",
      "Frida Kahlo",
      "The Two Fridas",
      "Claude Monet",
      "Impressionism"
    ]
  }
];

export const KIOSK_DOMAINS_STORAGE_KEY = "constellations_kiosk_domains_v1";
export const KIOSK_SELECTED_DOMAIN_STORAGE_KEY = "constellations_kiosk_selected_domain_v1";

export function loadKioskDomains(): KioskDomain[] {
  try {
    const raw = localStorage.getItem(KIOSK_DOMAINS_STORAGE_KEY);
    if (!raw) return DEFAULT_KIOSK_DOMAINS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_KIOSK_DOMAINS;
    const cleaned: KioskDomain[] = parsed
      .filter((d: any) => d && typeof d.id === "string" && typeof d.label === "string" && Array.isArray(d.terms))
      .map((d: any) => ({
        id: String(d.id),
        label: String(d.label),
        description: typeof d.description === "string" ? d.description : undefined,
        lockPair: (d.lockPair && typeof d.lockPair === "object" && typeof d.lockPair.atomicType === "string" && typeof d.lockPair.compositeType === "string")
          ? { atomicType: String(d.lockPair.atomicType), compositeType: String(d.lockPair.compositeType) }
          : undefined,
        terms: d.terms.map((t: any) => String(t)).filter((t: string) => t.trim().length > 0)
      }))
      .filter((d: KioskDomain) => d.id.trim().length > 0 && d.label.trim().length > 0);

    // Merge in any NEW default domains/terms without clobbering curated edits.
    // - If a default domain is missing entirely, add it.
    // - If it exists, keep the user's label/lockPair/description, but append any missing default terms.
    const byId = new Map<string, KioskDomain>(cleaned.map(d => [d.id, d]));
    DEFAULT_KIOSK_DOMAINS.forEach(def => {
      const existing = byId.get(def.id);
      if (!existing) {
        byId.set(def.id, def);
        return;
      }

      // Targeted label/description migrations for older shipped defaults (do not clobber curated edits).
      if (def.id === "mathematicians" && existing.label === "Mathematicians") {
        existing.label = def.label; // "Mathematics"
        if (!existing.description || existing.description === "Famous mathematicians and foundational ideas (good for Person ↔ Event-style exploration).") {
          existing.description = def.description;
        }
      }

      const termSet = new Set(existing.terms.map(t => t.toLowerCase()));
      const mergedTerms = [...existing.terms];
      def.terms.forEach(t => {
        const key = t.toLowerCase();
        if (!termSet.has(key)) {
          termSet.add(key);
          mergedTerms.push(t);
        }
      });
      byId.set(def.id, { ...existing, terms: mergedTerms });
    });

    const merged = Array.from(byId.values());
    return merged.length ? merged : DEFAULT_KIOSK_DOMAINS;
  } catch {
    return DEFAULT_KIOSK_DOMAINS;
  }
}

export function saveKioskDomains(domains: KioskDomain[]) {
  localStorage.setItem(KIOSK_DOMAINS_STORAGE_KEY, JSON.stringify(domains));
}

export function loadSelectedKioskDomainId(domains: KioskDomain[]): string {
  try {
    const raw = localStorage.getItem(KIOSK_SELECTED_DOMAIN_STORAGE_KEY);
    if (raw && domains.some(d => d.id === raw)) return raw;
  } catch { }
  return domains[0]?.id || "history";
}

export function saveSelectedKioskDomainId(domainId: string) {
  localStorage.setItem(KIOSK_SELECTED_DOMAIN_STORAGE_KEY, domainId);
}

