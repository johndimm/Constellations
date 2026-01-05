import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, X, Filter } from 'lucide-react';

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

interface BrowsePeopleProps {
  baseUrl?: string;
  onSelect?: (personName: string) => void;
  exploreTerm?: string;
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

const isLikelyPerson = (title: string) => {
  const lower = title.toLowerCase();
  if (lower.startsWith('category:')) return false;
  if (lower.startsWith('talk:')) return false;
  if (lower.startsWith('list of') || lower.startsWith('lists of')) return false;
  if (lower.includes('(disambiguation)')) return false;
  return true;
};

const pickDisplayCategories = (categories: string[] = []) => {
  // Show the most relevant categories (occupations, nationalities, birth years)
  const prioritized = categories.filter((cat) => {
    const lower = cat.toLowerCase();
    return (
      lower.includes('people') ||
      lower.includes('actors') ||
      lower.includes('actresses') ||
      lower.includes('singers') ||
      lower.includes('musicians') ||
      lower.includes('politicians') ||
      lower.includes('scientists') ||
      lower.includes('engineers') ||
      lower.includes('writers') ||
      lower.includes('artists') ||
      /\d{4}\s+births/.test(lower) ||
      lower.includes('from ')
    );
  });

  if (prioritized.length > 0) {
    return prioritized.slice(0, 4);
  }

  return categories.slice(0, 4);
};

const BrowsePeople: React.FC<BrowsePeopleProps> = ({ baseUrl = '', onSelect, exploreTerm }) => {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [continueParam, setContinueParam] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [occupation, setOccupation] = useState('');
  const [nationality, setNationality] = useState('');
  const [availableOccupations, setAvailableOccupations] = useState<string[]>([]);
  const [availableNationalities, setAvailableNationalities] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'title' | 'length' | 'fame'>('length');
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [seedPeople, setSeedPeople] = useState<Person[] | null>(null);
  const [filteredSeedPeople, setFilteredSeedPeople] = useState<Person[] | null>(null);
  const [seedLoaded, setSeedLoaded] = useState(0);
  const [seedTried, setSeedTried] = useState(false);
  const [continueRaw, setContinueRaw] = useState<string | null>(null);
  const [expandedPersonId, setExpandedPersonId] = useState<number | null>(null);

  const itemsPerPage = 48;

  // Basic curated lists for dropdowns (can be replaced by server-driven lists later)
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

    if (categoryFilter) {
      const clean = categoryFilter.startsWith('Category:')
        ? categoryFilter
        : `Category:${categoryFilter}`;
      parts.push(`incategory:"${clean}"`);
    }
    
    if (parts.length === 0) {
      return '';
    }
    
    // Add person/biography context if not already present
    const query = parts.join(' ');
    if (!/\b(person|people|biography|biographical)\b/i.test(query)) {
      return query + ' (person OR biography)';
    }
    return query;
  }, [searchTerm, occupation, nationality, categoryFilter]);

  const enrichPeople = useCallback(async (batch: Person[]) => {
    if (batch.length === 0) return;
    
    // Filter out people who already have both thumbnails and extracts to avoid redundant calls
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
        console.warn("Failed to enrich batch", e);
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

    // Use the reusable enrichment function
    enrichPeople(nextBatch);
  }, [itemsPerPage, seedLoaded, seedPeople, filteredSeedPeople, enrichPeople]);

  const fetchPeople = useCallback(async (search: string, offset: number = 0, continueToken: string | null = null, categoryOverride?: string | null, continueRawToken?: string | null) => {
    setLoading(true);
    setError(null);

    try {
      let url: string;
      const categoryToUse = categoryOverride !== undefined ? categoryOverride : categoryFilter;
      
      if (search.trim()) {
        // Use search API for searching
        url = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(search)}&srlimit=${itemsPerPage}&srprop=size|wordcount|timestamp&sroffset=${offset}&srnamespace=0&origin=*`;
      } else {
        // Use category members API for browsing via generator (single call)
        // Default to a broad people category to ensure results
        const baseCategory = categoryToUse || 'Category:Living people';
        const category = baseCategory.startsWith('Category:') ? baseCategory : `Category:${baseCategory}`;
        const continuePart = continueToken ? `&gcmcontinue=${encodeURIComponent(continueToken)}` : '';
        const continueRawPart = continueRawToken ? `&continue=${encodeURIComponent(continueRawToken)}` : '';
        url = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=${encodeURIComponent(category)}&gcmlimit=${itemsPerPage}&gcmtype=page&gcmnamespace=0&prop=info|pageimages|extracts|pageviews|categories&inprop=displaytitle&pithumbsize=150&exintro&explaintext&exlimit=max&exchars=500&cllimit=20&clshow=!hidden&pvipdays=60${continuePart}${continueRawPart}&origin=*`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.info || 'Wikipedia API error');
      }

      let results: Person[] = [];
      let nextContinue: string | null = null;

      if (search.trim()) {
        // Handle search results
        const searchResults = (data.query?.search || []).filter((item: any) => isLikelyPerson(item.title));
        results = searchResults.map((item: any) => ({
          title: item.title,
          pageid: item.pageid,
          extract: item.snippet,
          pageviews: 0,
        }));

        // Fetch thumbnails, extracts, pageviews, and categories
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

          results = results
            .map((item: any) => {
              const page = pagesByTitle.get(item.title);
              const categories = (page?.categories || []).map((c: any) => cleanCategoryLabel(c.title || '')).filter(Boolean);
              return {
                ...item,
                thumbnail: page?.thumbnail,
                extract: page?.extract || item.extract,
                pageviews: sumPageViews(page?.pageviews),
                categories,
                length: page?.length || 0,
              };
            })
            .filter((item: Person) => isLikelyPerson(item.title));
        }

        // Check if there are more results
        setHasMore(data.query?.searchinfo?.totalhits > offset + itemsPerPage);
        setContinueParam(null);
      } else {
        // Handle category members (single-call generator)
        const pages = data.query?.pages || {};
        const pageList = Object.values(pages) as any[];
        results = pageList
          .filter((page: any) => page.ns === 0 && isLikelyPerson(page.title))
          .map((page: any) => {
            const categories = (page?.categories || []).map((c: any) => cleanCategoryLabel(c.title || '')).filter(Boolean);
            const extractText = page?.extract || '';
            const trimmedExtract = extractText.length > 200 ? `${extractText.substring(0, 200)}...` : extractText;
            return {
              title: page.title,
              pageid: page.pageid,
              thumbnail: page.thumbnail,
              extract: trimmedExtract,
              pageviews: sumPageViews(page.pageviews),
              categories,
              _index: page.index || 0,
              length: page.length || 0,
            };
          })
          .sort((a: any, b: any) => {
            const lengthDiff = (b.length || 0) - (a.length || 0);
            if (lengthDiff !== 0) return lengthDiff;
            const fame = (b.pageviews || 0) - (a.pageviews || 0);
            if (fame !== 0) return fame;
            const summaryDiff = (b.extract?.length || 0) - (a.extract?.length || 0);
            if (summaryDiff !== 0) return summaryDiff;
            return a.title.localeCompare(b.title);
          });

        // Set continue parameters for pagination
        nextContinue = data.continue?.gcmcontinue || null;
        const nextRaw = data.continue?.continue || null;
        setHasMore(!!nextContinue);
        setContinueParam(nextContinue);
        setContinueRaw(nextRaw);
      }

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
  }, [itemsPerPage, categoryFilter]);

  // Initial load - prefer local top-biographies dataset; fallback to live fetch
  useEffect(() => {
    const loadSeed = async () => {
      if (seedTried) return;
      setSeedTried(true);
      try {
        setLoading(true);
        // Use the new top people list provided by the user
        const res = await fetch('/simplewiki_top_people.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('seed not found');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Transform simple list to Person interface, ensuring pageid exists for React keys
          const transformed = data.map((item: any, idx: number) => ({
            ...item,
            pageid: item.pageid || -(idx + 1), // Temporary ID if missing
            extract: item.extract || '',
            originalIndex: idx // Capture importance from JSON order
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
          
          // Sort by frequency and take top ones
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
        // Fallback to live fetch
        fetchPeople('', 0, null);
      }
    };
    loadSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedTried, fetchPeople]);

  // Immediate filtering when inputs change
  useEffect(() => {
    // Only use immediate filtering if we have seed data.
    // Wikipedia API search should still require Enter/Button.
    if (seedPeople) {
      handleSearch();
    }
  }, [occupation, nationality, categoryFilter, sortBy, searchTerm]);

  const handleSearch = () => {
    setCurrentPage(0);
    setContinueParam(null);
    setHasMore(true);
    
    // Use seed if we have it, even if there is a search term
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
      
      // Re-trigger enrichment for the filtered set
      enrichPeople(initial);
      
      // If we found results in our seed, we're done. 
      // If no results in seed and user typed a search term, fall back to Wikipedia search.
      if (filtered.length > 0 || !searchTerm.trim()) {
        return;
      }
    }

    // Fallback to Wikipedia API
    const query = buildSearchQuery();
    const browsingCategoryOnly = !!categoryFilter && !searchTerm.trim() && !occupation.trim() && !nationality.trim();
    if (browsingCategoryOnly) {
      fetchPeople('', 0, null, categoryFilter);
    } else {
      fetchPeople(query, 0, null);
    }
  };

  const handleCategoryClick = (category: string) => {
    const normalized = category.startsWith('Category:') ? category : `Category:${category}`;
    setCategoryFilter(normalized);
    setSearchTerm('');
    setOccupation('');
    setNationality('');
    setCurrentPage(0);
    setContinueParam(null);
    setHasMore(true);
    fetchPeople('', 0, null, normalized);
  };

  const handleLoadMore = () => {
    const nextOffset = (currentPage + 1) * itemsPerPage;
    const query = buildSearchQuery();
    const browsingCategoryOnly = !!categoryFilter && !searchTerm.trim() && !occupation.trim() && !nationality.trim();
    if (seedPeople) {
      loadMoreSeed();
    } else if (browsingCategoryOnly) {
      fetchPeople('', 0, continueParam, categoryFilter, continueRaw);
    } else if (query.trim()) {
      fetchPeople(query, nextOffset, null);
    } else {
      fetchPeople('', 0, continueParam, undefined, continueRaw);
    }
    setCurrentPage(prev => prev + 1);
  };

  const getAppLink = (personTitle: string) => {
    const params = new URLSearchParams({ q: personTitle });
    return `${baseUrl}?${params.toString()}`;
  };

  const sortedPeople = [...people].sort((a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    // Default sort: Use importance from seed JSON (originalIndex) if available
    if (sortBy === 'fame' || sortBy === 'length') {
      if (a.originalIndex !== undefined && b.originalIndex !== undefined) {
        return a.originalIndex - b.originalIndex;
      }
    }
    if (sortBy === 'length') {
      const lenDiff = (b.article_length || 0) - (a.article_length || 0);
      if (lenDiff !== 0) return lenDiff;
    }
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const textDiff = (b.extract?.length || 0) - (a.extract?.length || 0);
    return textDiff;
  });

  return (
    <div className="h-full bg-slate-900 text-white overflow-y-auto">
      <main className="max-w-7xl mx-auto p-4 pt-20">
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">People</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-2 rounded-lg font-medium border text-sm ${
                  showFilters
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Filter size={16} className="inline mr-2" />
                Filters
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search for people..."
                className="w-full bg-slate-800 border border-slate-600 text-white pl-10 pr-4 py-2 rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
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
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Search
            </button>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-slate-300 mb-1">Occupation</label>
                  <select
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 text-white px-3 py-2 rounded focus:ring-2 focus:ring-red-500 outline-none"
                  >
                    <option value="">Any</option>
                    {(availableOccupations.length ? availableOccupations : defaultOccupations).map((occ) => (
                      <option key={occ} value={occ}>{occ}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-slate-300 mb-1">Nationality</label>
                  <select
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 text-white px-3 py-2 rounded focus:ring-2 focus:ring-red-500 outline-none"
                  >
                    <option value="">Any</option>
                    {(availableNationalities.length ? availableNationalities : defaultNationalities).map((nat) => (
                      <option key={nat} value={nat}>{nat}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="block text-sm font-medium text-slate-300 mb-1">Sort By</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSortBy('length')}
                      className={`px-3 py-2 rounded ${
                        sortBy === 'length'
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      Importance
                    </button>
                    <button
                      onClick={() => setSortBy('title')}
                      className={`px-3 py-2 rounded ${
                        sortBy === 'title'
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      Title A-Z
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {(categoryFilter || searchTerm || occupation || nationality) && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {categoryFilter && (
              <span className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 text-sm px-3 py-1 rounded-full">
                Category: {cleanCategoryLabel(categoryFilter)}
                <button
                  onClick={() => {
                    setCategoryFilter(null);
                    setCurrentPage(0);
                    setContinueParam(null);
                    if (seedPeople && isPureBrowse()) {
                      handleSearch();
                    } else {
                    fetchPeople('', 0, null, null);
                    }
                  }}
                  className="text-slate-400 hover:text-white"
                  title="Clear category"
                >
                  <X size={14} />
                </button>
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg mb-4">
            Error: {error}
          </div>
        )}

        {loading && people.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            Loading...
          </div>
        )}

        {!loading && people.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            No people found. Try a different search term.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedPeople.map((person) => (
            <div
              key={person.pageid}
              onClick={() => {
                if (onSelect) {
                  onSelect(person.title);
                } else {
                  window.location.href = getAppLink(person.title);
                }
              }}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg p-4 transition-colors block cursor-pointer"
            >
              <div className="flex gap-4">
                {person.thumbnail && (
                  <img
                    src={person.thumbnail.source}
                    alt={person.title}
                    className="w-20 h-20 object-cover rounded flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-semibold text-white mb-1 line-clamp-2">{person.title}</h3>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setExpandedPersonId(expandedPersonId === person.pageid ? null : person.pageid);
                      }}
                      className="px-2 py-0.5 text-[10px] bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors shrink-0"
                    >
                      {expandedPersonId === person.pageid ? 'HIDE DATA' : 'DATA'}
                    </button>
                  </div>
                  {expandedPersonId === person.pageid && (
                    <div className="mt-2 p-3 bg-slate-950 rounded-lg border border-slate-700 text-[11px] font-mono shadow-inner">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                        <div className="text-slate-500">Score: <span className="text-amber-400">{(person.score || 0).toFixed(2)}</span></div>
                        <div className="text-slate-500">Gender: <span className="text-slate-300">{person.gender_guess || 'n/a'}</span></div>
                        <div className="text-slate-500">Born: <span className="text-slate-300">{person.birth_year || 'n/a'} ({person.century_birth || 'n/a'})</span></div>
                        <div className="text-slate-500">Status: <span className={person.is_living ? 'text-green-400' : 'text-slate-400'}>{person.is_living ? 'Living' : `Died ${person.death_year || 'n/a'}`}</span></div>
                        <div className="text-slate-500">Active Est: <span className="text-slate-300">{person.years_active_estimate || 0} years</span></div>
                        <div className="text-slate-500">Infobox: <span className="text-slate-300">{person.has_infobox ? 'Yes' : 'No'}</span></div>
                      </div>
                      <div className="border-t border-slate-800 pt-2 mt-2">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <div className="text-slate-500">Article Len: <span className="text-slate-300">{(person.article_length || 0).toLocaleString()}</span></div>
                          <div className="text-slate-500">Lead Len: <span className="text-slate-300">{(person.lead_paragraph_length || 0).toLocaleString()}</span></div>
                          <div className="text-slate-500">Links In: <span className="text-slate-300">{(person.incoming_links || 0).toLocaleString()}</span></div>
                          <div className="text-slate-500">Links Out: <span className="text-slate-300">{(person.outgoing_links || 0).toLocaleString()}</span></div>
                          <div className="text-slate-500">Density: <span className="text-slate-300">{(person.internal_link_density || 0).toFixed(4)}</span></div>
                        </div>
                      </div>
                      {(person.occupation_keywords?.length || 0) > 0 && (
                        <div className="mt-2 text-slate-500">
                          Keywords: <span className="text-indigo-300">{person.occupation_keywords?.join(', ')}</span>
                        </div>
                      )}
                      {person.categories && person.categories.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-800">
                          <div className="text-slate-500 mb-1">Categories:</div>
                          <div className="flex flex-wrap gap-2">
                            {pickDisplayCategories(person.categories).map((cat) => (
                              <button
                                key={cat}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleCategoryClick(cat);
                                }}
                                className="px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
                              >
                                {cleanCategoryLabel(cat)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {person.extract && (
                    <p className="text-sm text-slate-400 line-clamp-3">{person.extract}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="text-center mt-8">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}

        {people.length > 0 && (
          <div className="text-center mt-4 text-slate-400 text-sm">
            Showing {people.length} {people.length === 1 ? 'person' : 'people'}
            {(searchTerm || occupation || nationality) && (
              <span> for "{buildSearchQuery().replace(/\s*\(person OR biography\)/i, '')}"</span>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default BrowsePeople;
