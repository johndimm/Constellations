
export const fetchWikipediaImage = async (query: string): Promise<string | null> => {
  try {
    // 1. Search for the page to get the correct title/pageId
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&srlimit=1&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    
    if (!searchData.query?.search?.length) return null;
    
    const title = searchData.query.search[0].title;
    
    // 2. Fetch the page image
    const imageUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(title)}&pithumbsize=200&origin=*`;
    const imageRes = await fetch(imageUrl);
    const imageData = await imageRes.json();
    
    const pages = imageData.query?.pages;
    if (!pages) return null;
    
    const pageId = Object.keys(pages)[0];
    if (pageId === "-1") return null;
    
    return pages[pageId].thumbnail?.source || null;
  } catch (e) {
    console.error("Wiki image fetch failed for:", query, e);
    return null;
  }
};
