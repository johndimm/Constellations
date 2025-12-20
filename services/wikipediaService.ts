
export const fetchWikipediaImage = async (query: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

  // Helper to fetch image for a specific title
  const fetchImageForTitle = async (title: string, signal: AbortSignal): Promise<string | null> => {
    const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(title)}&pithumbsize=300&redirects=1&origin=*`;
    const imagesRes = await fetch(imagesUrl, { signal });
    const imagesData = await imagesRes.json();
    const pages = imagesData.query?.pages;

    if (pages) {
      const pageList = Object.values(pages) as any[];
      if (pageList.length > 0 && pageList[0].thumbnail?.source) {
        return pageList[0].thumbnail.source;
      }
    }
    return null;
  };

  try {
    // 1. First Wikipedia Attempt: Exact or Top Search
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: controller.signal });
    const searchData = await searchRes.json();

    if (searchData.query?.search?.length) {
      const topTitle = searchData.query.search[0].title;
      const img = await fetchImageForTitle(topTitle, controller.signal);
      if (img) {
        clearTimeout(timeoutId);
        return img;
      }

      // 2. Second Wikipedia Attempt: Try appending " (film)" if strict failed and we suspect it's a movie/ambiguous
      // Only try if the query doesn't already have parenthesis to avoid "Title (film) (film)"
      if (!query.includes('(')) {
        const filmSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query + " (film)")}&srlimit=1&origin=*`;
        const filmSearchRes = await fetch(filmSearchUrl, { signal: controller.signal });
        const filmSearchData = await filmSearchRes.json();
        if (filmSearchData.query?.search?.length) {
          const filmTitle = filmSearchData.query.search[0].title;
          const filmImg = await fetchImageForTitle(filmTitle, controller.signal);
          if (filmImg) {
            clearTimeout(timeoutId);
            return filmImg;
          }
        }
      }
    }

    // 3. Google Books Fallback (Enhanced)
    // Try 'intitle' first for stricter matching (good for finding book versions of movies -> posters)
    let booksUrl = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(query)}&maxResults=1`;
    let booksRes = await fetch(booksUrl, { signal: controller.signal });

    if (booksRes.ok) {
      let booksData = await booksRes.json();
      if (booksData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail) {
        clearTimeout(timeoutId);
        return booksData.items[0].volumeInfo.imageLinks.thumbnail.replace('http://', 'https://');
      }
    }

    // 4. Google Books Fallback (General)
    // If intitle failed, try general query
    booksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
    booksRes = await fetch(booksUrl, { signal: controller.signal });

    if (booksRes.ok) {
      let booksData = await booksRes.json();
      if (booksData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail) {
        clearTimeout(timeoutId);
        return booksData.items[0].volumeInfo.imageLinks.thumbnail.replace('http://', 'https://');
      }
    }

  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      console.error("Image fetch failed for:", query, e);
    }
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
};
