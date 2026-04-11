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
    id: "actors-movies-tv",
    label: "Actors / Movies / TV",
    description: "People ↔ Works (films / TV).",
    terms: [
      "The Godfather",
      "Pulp Fiction",
      "Schindler's List",
      "2001: A Space Odyssey",
      "The Lord of the Rings (film series)",
      "The Sopranos",
      "Breaking Bad",
      "Game of Thrones",
      "Martin Scorsese",
      "Stanley Kubrick",
      "Steven Spielberg",
      "Alfred Hitchcock",
      "Meryl Streep",
      "Marlon Brando",
      "Tom Hanks",
      "Kevin Bacon",
      "Christopher Nolan",
      "Coen Brothers"
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
    id: "literature",
    label: "Literature",
    description: "Authors ↔ Books (and book-related events/works).",
    terms: [
      "Stephen King",
      "Cormac McCarthy",
      "Charles Dickens",
      "William Shakespeare",
      "Jane Austen",
      "Leo Tolstoy",
      "Fyodor Dostoevsky",
      "Virginia Woolf",
      "Franz Kafka",
      "Gabriel Garcia Marquez",
      "George Orwell",
      "Toni Morrison",
      "J. R. R. Tolkien",
      "H. P. Lovecraft",
      "Mary Shelley",
      "Moby-Dick",
      "Pride and Prejudice",
      "1984",
      "The Road",
      "Blood Meridian"
    ]
  },
  {
    id: "popular-music",
    label: "Popular Music",
    description: "Artists, albums, and songs.",
    terms: [
      "The Beatles",
      "Abbey Road",
      "Beyoncé",
      "Lemonade (Beyoncé album)",
      "Taylor Swift",
      "Billie Eilish",
      "Olivia Rodrigo",
      "Radiohead",
      "Kendrick Lamar",
      "To Pimp a Butterfly",
      "DAMN.",
      "Drake",
      "Travis Scott",
      "ASTROWORLD",
      "Cardi B",
      "Megan Thee Stallion",
      "Tyler, the Creator",
      "Bad Bunny",
      "Doja Cat",
      "Lil Nas X",
      "Prince",
      "David Bowie",
      "Daft Punk",
      "Discovery (Daft Punk album)",
      "Giant Steps (album)"
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
      "Yo-Yo Ma",
      "Glenn Gould",
      "Maria Callas",
      "Luciano Pavarotti",
      "Gustavo Dudamel",
      "Hilary Hahn",
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
      "Francis Fukuyama",
      "Yuval Noah Harari",
      "Jared Diamond",
      "Julius Caesar",
      "Cleopatra",
      "Alexander the Great",
      "Genghis Khan",
      "Martin Luther",
      "Protestant Reformation",
      "George Washington",
      "American Revolution",
      "Abraham Lincoln",
      "American Civil War",
      "Napoleon Bonaparte",
      "French Revolution",
      "World War II",
      "Winston Churchill",
      "Cold War",
      "Fall of the Berlin Wall",
      "Mahatma Gandhi",
      "Indian independence movement",
      "Nelson Mandela",
      "Apartheid",
      "Watergate scandal",
      "Apollo 11",
      "Renaissance"
    ]
  },
  {
    id: "science",
    label: "Science",
    description: "Scientists ↔ Discoveries/Experiments (safe, high-signal).",
    terms: [
      "Galileo Galilei",
      "Isaac Newton",
      "Michael Faraday",
      "James Clerk Maxwell",
      "Nikola Tesla",
      "Louis Pasteur",
      "Max Planck",
      "Niels Bohr",
      "Enrico Fermi",
      "Richard Feynman",
      "Richard Dawkins",
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
  },
  {
    id: "philosophy",
    label: "Philosophy",
    description: "Philosophers, schools, and foundational works (ancient → modern).",
    terms: [
      // Ancients
      "Socrates",
      "Plato",
      "Aristotle",
      "Epicurus",
      "Zeno of Citium",
      "Cicero",
      "Seneca the Younger",
      "Marcus Aurelius",
      "Plotinus",

      // Early modern / modern canon (high-signal entry points)
      "René Descartes",
      "David Hume",
      "Immanuel Kant",

      // Analytic tradition + 20th century
      "Gottlob Frege",
      "Bertrand Russell",
      "Ludwig Wittgenstein",
      "W. V. O. Quine",
      "Hilary Putnam",
      "Thomas Nagel",
      "Saul Kripke",
      "John Rawls"
    ]
  }
];

export const KIOSK_DOMAINS_STORAGE_KEY = "constellations_kiosk_domains_v1";
export const KIOSK_SELECTED_DOMAIN_STORAGE_KEY = "constellations_kiosk_selected_domain_v1";

export function hasLocalKioskDomains(): boolean {
  return false;
}

export function clearLocalKioskDomains() {
}

export function clearLocalSelectedKioskDomainId() {
}

export function loadKioskDomains(): KioskDomain[] {
  return DEFAULT_KIOSK_DOMAINS;
}

export function saveKioskDomains(domains: KioskDomain[]) {
}

export function loadSelectedKioskDomainId(domains: KioskDomain[]): string {
  return domains[0]?.id || "history";
}

export function saveSelectedKioskDomainId(domainId: string) {
}

