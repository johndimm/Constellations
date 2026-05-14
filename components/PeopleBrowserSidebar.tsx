"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { Search, X, Filter, ChevronRight } from 'lucide-react';

interface Person {
  title: string;
  pageid: number;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  extract?: string;
  pageviews?: number;
  categories?: string[];
  article_length?: number;
  originalIndex?: number;
  birth_year?: number | null;
  death_year?: number | null;
  is_living?: boolean;
  century_birth?: string | null;
  century_death?: string | null;
  years_active_estimate?: number | null;
  lead_paragraph_length?: number | null;
  internal_link_density?: number | null;
  gender_guess?: string | null;
  occupation_keywords?: string[];
  nationality_keywords?: string[];
  has_infobox?: boolean;
  score?: number;
  outgoing_links?: number;
  incoming_links?: number;
  [key: string]: any;
}

interface PeopleBrowserSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPerson: (personName: string) => void;
  /** With `useAbsoluteLayout`, use `top-14` in the constellations `main`; with `fixed`, use viewport top. */
  offsetTopClass?: string;
  /** When true, position inside the graph `main` (embedded hosts); avoids broken `fixed` in iframes/clipped roots. */
  useAbsoluteLayout?: boolean;
}

const sumPageViews = (pageviews: Record<string, number> | undefined) => {
  if (!pageviews) return 0;
  return Object.values(pageviews).reduce((total, value) => {
    if (typeof value !== 'number') return total;
    return total + value;
  }, 0);
};

const cleanCategoryLabel = (category: string) =>
  category.replace(/^Category:/i, '').replace(/_/g, ' ');

const PeopleBrowserSidebar: React.FC<PeopleBrowserSidebarProps> = ({ isOpen, onClose, onSelectPerson, offsetTopClass = "top-16", useAbsoluteLayout = false }) => {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [continueParam, setContinueParam] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [occupation, setOccupation] = useState('');
  const [nationality, setNationality] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [seedPeople, setSeedPeople] = useState<Person[] | null>(null);
  const [filteredSeedPeople, setFilteredSeedPeople] = useState<Person[] | null>(null);
  const [seedLoaded, setSeedLoaded] = useState(0);
  const [seedTried, setSeedTried] = useState(false);
  const [expandedPersonId, setExpandedPersonId] = useState<number | null>(null);
  const [availableOccupations, setAvailableOccupations] = useState<string[]>([]);
  const [availableNationalities, setAvailableNationalities] = useState<string[]>([]);

  const defaultOccupations = [
    'Actor', 'Actress', 'Musician', 'Singer', 'Composer', 'Writer', 'Author', 'Poet',
    'Scientist', 'Physicist', 'Mathematician', 'Engineer', 'Politician', 'President', 'Prime Minister',
    'Athlete', 'Footballer', 'Basketball player', 'Tennis player',
    'Artist', 'Painter', 'Sculptor', 'Photographer', 'Director', 'Producer'
  ];

  const defaultNationalities = [
    'American', 'British', 'Canadian', 'Australian', 'French', 'German', 'Italian', 'Spanish', 'Russian',
    'Chinese', 'Japanese', 'Indian', 'Brazilian', 'Mexican', 'Argentine', 'Irish', 'Scottish', 'Welsh',
    'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Greek', 'Turkish', 'Egyptian', 'Nigerian',
    'South African', 'New Zealander', 'Israeli', 'Saudi Arabian', 'Korean', 'Thai', 'Vietnamese', 'Indonesian'
  ];

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const itemsPerPage = 50;

  const isPureBrowse = useCallback(() => !searchTerm.trim() && !occupation && !nationality, [searchTerm, occupation, nationality]);

  const buildSearchQuery = useCallback(() => {
    const parts: string[] = [];

    if (searchTerm.trim()) {
      parts.push(searchTerm.trim());
    }

    if (occupation.trim()) {
      parts.push(occupation.trim());
    }

    if (nationality.trim()) {
      parts.push(nationality.trim());
    }

    if (parts.length === 0) {
      return '';
    }

    const query = parts.join(' ');
    if (!/\b(person|people|biography|biographical)\b/i.test(query)) {
      return query + ' (person OR biography)';
    }
    return query;
  }, [searchTerm, occupation, nationality]);

  const enrichPeople = useCallback(async (batch: Person[]) => {
    if (batch.length === 0) return;

    // Only enrich those that lack thumbnails, extracts, or categories
    const toEnrich = batch.filter(p => !p.thumbnail || !p.extract || !p.categories);
    if (toEnrich.length === 0) return;

    // Wikipedia's exlimit for extracts is 20. We must batch these calls.
    const batchSize = 20;
    for (let i = 0; i < toEnrich.length; i += batchSize) {
      const currentBatch = toEnrich.slice(i, i + batchSize);
      const titles = currentBatch.map(p => p.title).join('|');
      const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=info|pageimages|extracts|pageviews|categories&inprop=displaytitle&titles=${encodeURIComponent(titles)}&pithumbsize=150&exintro&explaintext&exchars=500&exlimit=max&cllimit=20&clshow=!hidden&pvipdays=60&origin=*&redirects=1`;

      try {
        const infoRes = await fetch(infoUrl);
        const infoData = await infoRes.json();
        const pages = infoData.query?.pages || {};
        const pagesByTitle = new Map<string, any>();

        const titleMap = new Map<string, string>();
        if (infoData.query?.normalized) {
          infoData.query.normalized.forEach((n: any) => titleMap.set(n.to, n.from));
        }
        if (infoData.query?.redirects) {
          infoData.query.redirects.forEach((r: any) => titleMap.set(r.to, r.from));
        }

        Object.values(pages).forEach((page: any) => {
          if (page.title) {
            pagesByTitle.set(page.title, page);
            const originalTitle = titleMap.get(page.title);
            if (originalTitle) pagesByTitle.set(originalTitle, page);
          }
        });

        setPeople(prev => prev.map(p => {
          const info = pagesByTitle.get(p.title);
          if (!info) return p;
          return {
            ...p,
            pageid: info.pageid || p.pageid,
            thumbnail: info.thumbnail || p.thumbnail,
            extract: info.extract || p.extract,
            pageviews: sumPageViews(info.pageviews),
            categories: (info.categories || []).map((c: any) => cleanCategoryLabel(c.title || '')).filter(Boolean),
            length: info.length || p.length
          };
        }));
      } catch (e) {
        console.warn("Failed to enrich sidebar batch", e);
      }
    }
  }, []);

  const primeFromSeed = useCallback((all: Person[]) => {
    const initial = all.slice(0, itemsPerPage);
    setPeople(initial);
    setSeedLoaded(initial.length);
    setHasMore(all.length > initial.length);
    setLoading(false);
    setError(null);
  }, [itemsPerPage]);

  const loadMoreSeed = useCallback(async () => {
    const listToUse = filteredSeedPeople || seedPeople;
    if (!listToUse) return;
    const nextBatchEnd = Math.min(seedLoaded + itemsPerPage, listToUse.length);
    const nextBatch = listToUse.slice(seedLoaded, nextBatchEnd);

    // Add them immediately as placeholders
    setPeople(prev => [...prev, ...nextBatch]);
    setSeedLoaded(nextBatchEnd);
    setHasMore(nextBatchEnd < listToUse.length);

    enrichPeople(nextBatch);
  }, [itemsPerPage, seedLoaded, seedPeople, filteredSeedPeople, enrichPeople]);

  const isLikelyPerson = (title: string) => {
    const lower = title.toLowerCase();
    if (lower.startsWith('category:')) return false;
    if (lower.startsWith('talk:')) return false;
    if (lower.startsWith('list of') || lower.startsWith('lists of')) return false;
    if (lower.startsWith('dictionary of')) return false;
    if (lower.includes('(disambiguation)')) return false;
    if (lower.includes('(film)') || lower.includes('(movie)')) return false;
    // Filter out years, decades, centuries
    if (/^\d{4}$/.test(title.trim())) return false; // e.g., "1904"
    if (/^\d{4}s$/.test(title.trim())) return false; // e.g., "1900s"
    // Filter out common non-person titles
    const nonPersonTitles = ['biographical film', 'biography', 'autobiography'];
    if (nonPersonTitles.includes(lower)) return false;
    return true;
  };

  const fetchPeople = useCallback(async (search: string, offset: number = 0, continueToken: string | null = null) => {
    setLoading(true);
    setError(null);

    try {
      let url: string;
      let results: Person[] = [];

      // Always use search API - use a more specific query to find biographies
      // Search for articles in biographical categories or with biographical terms
      const searchQuery = search.trim() || 'insource:"born" (biography OR "was a" OR "is a" OR "was an" OR "is an")';
      url = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srlimit=${itemsPerPage}&srprop=size|wordcount|timestamp&sroffset=${offset}&origin=*`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.info || 'Wikipedia API error');
      }

      // Handle search results
      const searchResults = (data.query?.search || []).filter((item: any) => isLikelyPerson(item.title));
      results = searchResults.map((item: any) => ({
        title: item.title,
        pageid: item.pageid,
        extract: item.snippet,
        wordcount: item.wordcount,
        size: item.size,
      }));

      // Fetch thumbnails and extracts for search results
      if (results.length > 0) {
        const titles = results.map((item: any) => item.title).join('|');
        const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=info|pageimages|extracts|pageviews|categories&inprop=displaytitle&titles=${encodeURIComponent(titles)}&pithumbsize=150&exintro&explaintext&exchars=500&exlimit=max&cllimit=20&clshow=!hidden&pvipdays=60&origin=*`;
        const infoResponse = await fetch(infoUrl);
        const infoData = await infoResponse.json();
        const pages = infoData.query?.pages || {};

        const pagesByTitle = new Map<string, any>();
        Object.values(pages).forEach((page: any) => {
          if (page.title) {
            pagesByTitle.set(page.title, page);
          }
        });

        results = results.map((item: any) => {
          const page = pagesByTitle.get(item.title);
          return {
            ...item,
            thumbnail: page?.thumbnail,
            extract: page?.extract || item.extract,
            pageviews: sumPageViews(page?.pageviews),
            article_length: page?.length || 0,
          };
        }).sort((a: any, b: any) => {
          // Sort by importance: article length, then pageviews, then extract length
          const lengthDiff = (b.article_length || 0) - (a.article_length || 0);
          if (lengthDiff !== 0) return lengthDiff;
          const fame = (b.pageviews || 0) - (a.pageviews || 0);
          if (fame !== 0) return fame;
          const summaryDiff = (b.extract?.length || 0) - (a.extract?.length || 0);
          if (summaryDiff !== 0) return summaryDiff;
          return a.title.localeCompare(b.title);
        });
      }

      setHasMore(data.query?.searchinfo?.totalhits > offset + itemsPerPage);

      if (offset === 0) {
        setPeople(results);
      } else {
        setPeople(prev => [...prev, ...results]);
      }
    } catch (err: any) {
      console.error('Error fetching people:', err);
      setError(err.message || 'Failed to fetch people');
    } finally {
      setLoading(false);
    }
  }, [itemsPerPage]);

  const handleFilterClick = (type: string, value: string) => {
    if (type === 'occupation') setOccupation(value);
    if (type === 'nationality') setNationality(value);
    setSearchTerm('');
    setCurrentPage(0);
    setContinueParam(null);
  };

  const extractAspects = (person: Person) => {
    const aspects: { type: string; value: string }[] = [];
    if (person.occupation_keywords?.length) {
      person.occupation_keywords.slice(0, 2).forEach(v => aspects.push({ type: 'occupation', value: v }));
    }
    if (person.nationality_keywords?.length) {
      person.nationality_keywords.slice(0, 1).forEach(v => aspects.push({ type: 'nationality', value: v }));
    }
    return aspects;
  };

  // Initial load when sidebar opens - prefer local top-biographies dataset; fallback to live fetch
  useEffect(() => {
    const loadSeed = async () => {
      if (!isOpen || seedTried) return;
      setSeedTried(true);
      try {
        setLoading(true);
        // Use the new top people list provided by the user
        const res = await fetch('/simplewiki_top_people.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('seed not found');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Transform simple list to Person interface
          const transformed = data.map((item: any, idx: number) => ({
            ...item,
            pageid: item.pageid || -(idx + 1),
            extract: item.extract || '',
            originalIndex: idx
          }));
          setSeedPeople(transformed);

          // Extract occupations and nationalities from keywords
          const occMap = new Map<string, number>();
          const natMap = new Map<string, number>();
          transformed.forEach(p => {
            (p.occupation_keywords || []).forEach((o: string) => {
              const formatted = o.charAt(0).toUpperCase() + o.slice(1);
              occMap.set(formatted, (occMap.get(formatted) || 0) + 1);
            });
            (p.nationality_keywords || []).forEach((n: string) => {
              const formatted = n.charAt(0).toUpperCase() + n.slice(1);
              natMap.set(formatted, (natMap.get(formatted) || 0) + 1);
            });
          });

          setAvailableOccupations(Array.from(occMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0]));
          setAvailableNationalities(Array.from(natMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0]));

          setFilteredSeedPeople(transformed);

          // Enrich the first batch immediately
          const firstBatch = transformed.slice(0, itemsPerPage);
          setPeople(firstBatch);
          setSeedLoaded(firstBatch.length);
          setHasMore(transformed.length > firstBatch.length);

          enrichPeople(firstBatch);

          setLoading(false);
          setError(null);
          return;
        }
        throw new Error('seed empty');
      } catch (err) {
        // Fall back to Wikipedia API for browsing
        fetchPeople('', 0, null);
      }
    };
    loadSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, seedTried, fetchPeople]);

  // Immediate filtering when inputs change
  useEffect(() => {
    if (seedPeople) {
      handleSearch();
    }
  }, [occupation, nationality, seedPeople, searchTerm]);

  const handleSearch = () => {
    setCurrentPage(0);
    setContinueParam(null);
    setHasMore(true);

    if (seedPeople) {
      let filtered = [...seedPeople];

      if (searchTerm.trim()) {
        const lowerSearch = searchTerm.toLowerCase().trim();
        filtered = filtered.filter(p =>
          p.title.toLowerCase().includes(lowerSearch) ||
          (p.occupation_keywords || []).some((o: string) => o.toLowerCase().includes(lowerSearch)) ||
          (p.nationality_keywords || []).some((n: string) => n.toLowerCase().includes(lowerSearch))
        );
      }

      if (occupation) {
        filtered = filtered.filter(p =>
          (p.occupation_keywords || []).some((o: string) => o.toLowerCase() === occupation.toLowerCase())
        );
      }

      if (nationality) {
        filtered = filtered.filter(p =>
          (p.nationality_keywords || []).some((n: string) => n.toLowerCase() === nationality.toLowerCase())
        );
      }

      setFilteredSeedPeople(filtered);
      const initial = filtered.slice(0, itemsPerPage);
      setPeople(initial);
      setSeedLoaded(initial.length);
      setHasMore(filtered.length > initial.length);

      enrichPeople(initial);

      if (filtered.length > 0 || !searchTerm.trim()) {
        return;
      }
    }

    const query = buildSearchQuery();
    fetchPeople(query, 0, null);
  };

  const handleSelect = (personTitle: string) => {
    onSelectPerson(personTitle);
  };

  const handleLoadMore = () => {
    if (seedPeople) {
      loadMoreSeed();
      return;
    }

    // Always use search API with offset for pagination
    const nextOffset = (currentPage + 1) * itemsPerPage;
    const query = buildSearchQuery() || 'insource:"born" (biography OR "was a" OR "is a" OR "was an" OR "is an")';
    fetchPeople(query, nextOffset, null);
    setCurrentPage(prev => prev + 1);
  };

  // No need to sort - Wikipedia's search API already returns results sorted by relevance
  // The most famous/important people come first

  if (!isOpen) return null;

  const pos = useAbsoluteLayout ? "absolute bottom-0" : "fixed";
  const panelClasses = `${pos} right-3 sm:right-4 z-[60] transition-transform duration-300 ease-in-out ${isCollapsed ? "translate-x-[calc(100%+2rem)]" : "translate-x-0"} ${offsetTopClass}`;
  const panelStyle = isMobile
    ? { width: "calc(100% - 1.5rem)", maxWidth: "28rem" }
    : { width: "28rem" };

  return (
    <div className={panelClasses} style={panelStyle}>
      <div
        className={`bg-slate-900/95 backdrop-blur-xl rounded-xl border border-slate-700 shadow-2xl relative pointer-events-auto flex flex-col ${
          useAbsoluteLayout ? "max-h-[calc(100%-1.5rem)]" : "max-h-[calc(100vh-2rem)]"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-white">Browse People</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                <ChevronRight size={18} className={isCollapsed ? 'rotate-180' : ''} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex gap-2 mb-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search..."
                className="w-full bg-slate-800 border border-slate-600 text-white pl-8 pr-8 py-1.5 text-sm rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
              />
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setOccupation('');
                    setNationality('');
                    setCurrentPage(0);
                    setContinueParam(null);
                    if (seedPeople && isPureBrowse()) {
                      handleSearch();
                    } else {
                      fetchPeople('', 0, null);
                    }
                  }}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-2 py-1.5 rounded-lg text-sm border ${showFilters
                  ? 'bg-slate-700 border-slate-500 text-white'
                  : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                }`}
              title="Filters"
            >
              <Filter size={14} />
            </button>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 mb-2 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">Occupation</label>
                  <select
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 text-white px-2 py-1.5 rounded text-xs focus:ring-1 focus:ring-red-500 outline-none"
                  >
                    <option value="">Any</option>
                    {(availableOccupations.length ? availableOccupations : defaultOccupations).map((occ) => (
                      <option key={occ} value={occ}>{occ}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">Nationality</label>
                  <select
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 text-white px-2 py-1.5 rounded text-xs focus:ring-1 focus:ring-red-500 outline-none"
                  >
                    <option value="">Any</option>
                    {(availableNationalities.length ? availableNationalities : defaultNationalities).map((nat) => (
                      <option key={nat} value={nat}>{nat}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 p-2 rounded-lg mb-3 text-xs">
              {error}
            </div>
          )}

          {loading && people.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Loading...
            </div>
          )}

          {!loading && people.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              No people found.
            </div>
          )}

          <div className="space-y-2">
            {people.map((person) => {
              const aspects = extractAspects(person);
              return (
                <div
                  key={person.pageid}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3"
                >
                  <button
                    onClick={() => handleSelect(person.title)}
                    className="w-full text-left"
                  >
                    <div className="flex gap-3">
                      {person.thumbnail && (
                        <img
                          src={person.thumbnail.source}
                          alt={person.title}
                          className="w-12 h-12 object-cover rounded flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="font-semibold text-white text-sm mb-1 line-clamp-1">{person.title}</h3>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setExpandedPersonId(expandedPersonId === person.pageid ? null : person.pageid);
                            }}
                            className="px-1.5 py-0.5 text-[9px] bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors shrink-0"
                          >
                            {expandedPersonId === person.pageid ? 'HIDE' : 'DATA'}
                          </button>
                        </div>
                        {expandedPersonId === person.pageid && (
                          <div className="mt-2 p-2 bg-slate-950 rounded border border-slate-700 text-[10px] font-mono shadow-inner">
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mb-1">
                              <div className="text-slate-500">Score: <span className="text-amber-400">{(person.score || 0).toFixed(1)}</span></div>
                              <div className="text-slate-500">Gender: <span className="text-slate-300">{person.gender_guess || 'n/a'}</span></div>
                              <div className="text-slate-500">Born: <span className="text-slate-300">{person.birth_year || 'n/a'}</span></div>
                              <div className="text-slate-500">Status: <span className={person.is_living ? 'text-green-400' : 'text-slate-400'}>{person.is_living ? 'Living' : 'Deceased'}</span></div>
                            </div>
                            <div className="border-t border-slate-800 pt-1 mt-1">
                              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px]">
                                <div className="text-slate-500">Art. Len: <span className="text-slate-300">{(person.article_length || 0).toLocaleString()}</span></div>
                                <div className="text-slate-500">Links: <span className="text-slate-300">{(person.incoming_links || 0).toLocaleString()} in</span></div>
                              </div>
                            </div>
                            {aspects.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-slate-800">
                                {aspects.map((aspect, idx) => (
                                  <button
                                    key={idx}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleFilterClick(aspect.type, aspect.value);
                                    }}
                                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[9px] border border-slate-700 transition-colors"
                                    title={`Filter by ${aspect.type}: ${aspect.value}`}
                                  >
                                    {aspect.value}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {person.extract && (
                          <p className="text-xs text-slate-400 line-clamp-2">{person.extract}</p>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="text-center mt-4">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}

          {people.length > 0 && (
            <div className="text-center mt-3 text-slate-400 text-xs">
              Showing {people.length} {people.length === 1 ? 'person' : 'people'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PeopleBrowserSidebar;
