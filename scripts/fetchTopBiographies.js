#!/usr/bin/env node
// Generate a ranked list of long biographies by article length (descending) and save to public/top-biographies.json
// Source: Wikipedia Special:Longpages (namespace 0), filtered to likely humans via categories.
import fs from 'fs/promises';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const OUTPUT_PATH = 'public/top-biographies.json';
const CHUNK_SIZE = 40; // Titles per Wikipedia API call
const LONGPAGE_LIMIT = 5000; // How many longest pages to scan before filtering
const OUTPUT_COUNT = 2000; // How many biographies to keep in the output

const sumPageViews = (pageviews) => {
  if (!pageviews) return 0;
  return Object.values(pageviews).reduce((total, value) => (typeof value === 'number' ? total + value : total), 0);
};

const isLikelyBiography = (categories = []) => {
  const lower = categories.map((c) => c.toLowerCase());
  const hasBioMarker = lower.some((c) =>
    c.includes(' births') ||
    c.includes('living people') ||
    c.includes('deaths') ||
    c.includes('people from') ||
    c.includes('actors') ||
    c.includes('actresses') ||
    c.includes('musicians') ||
    c.includes('singers') ||
    c.includes('writers') ||
    c.includes('politicians') ||
    c.includes('athletes') ||
    c.includes('footballers') ||
    c.includes('cricketers') ||
    c.includes('biographers') ||
    c.includes('painters') ||
    c.includes('sculptors') ||
    c.includes('scientists')
  );
  const hasBadMarker = lower.some((c) =>
    c.includes('lists of') ||
    c.includes('disambiguation pages') ||
    c.includes('redirects') ||
    c.includes('fictional')
  );
  return hasBioMarker && !hasBadMarker;
};

const fetchLongestPages = async () => {
  let offset = 0;
  const pages = [];
  while (pages.length < LONGPAGE_LIMIT) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'querypage',
      qppage: 'Longpages',
      qpnamespace: '0',
      qplimit: 'max',
      qpoffset: String(offset),
      formatversion: '2',
      origin: '*'
    });
    const res = await fetch(`${WIKI_API}?${params.toString()}`, {
      headers: {
        'User-Agent': 'Constellations/seed-fetcher (long biographies list)'
      }
    });
    if (!res.ok) {
      throw new Error(`Wikipedia Longpages error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const batch = data?.query?.querypage?.results || [];
    if (batch.length === 0) {
      console.error('No results returned for Longestpages; response snippet:', JSON.stringify(data).slice(0, 400));
      break;
    }
    pages.push(...batch);
    offset += batch.length;
    process.stdout.write(`Fetched ${pages.length} longest pages...\r`);
    if (!data?.continue?.qpoffset) break;
  }
  process.stdout.write('\n');
  return pages.slice(0, LONGPAGE_LIMIT).map((p) => p.title).filter(Boolean);
};

const fetchPageDetails = async (titles) => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'info|pageimages|extracts|pageviews|categories',
    inprop: 'displaytitle',
    redirects: '1',
    explaintext: '1',
    exintro: '1',
    exchars: '400',
    exlimit: 'max',
    pithumbsize: '150',
    cllimit: '20',
    clshow: '!hidden',
    pvipdays: '60',
    titles: titles.join('|'),
    origin: '*'
  });

  const res = await fetch(`${WIKI_API}?${params.toString()}`, {
    headers: {
      'User-Agent': 'Constellations/seed-fetcher (long biographies list)'
    }
  });
  if (!res.ok) {
    throw new Error(`Wikipedia API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const pages = data.query?.pages || {};
  return Object.values(pages)
    .filter((page) => page.ns === 0 && page.pageid)
    .map((page) => {
      const extractText = page.extract || '';
      const trimmedExtract = extractText.length > 200 ? `${extractText.substring(0, 200)}...` : extractText;
      const categories = (page.categories || []).map((c) => c.title || '').filter(Boolean);
      return {
        title: page.title,
        pageid: page.pageid,
        length: page.length || 0,
        pageviews: sumPageViews(page.pageviews),
        extract: trimmedExtract,
        categories,
        thumbnail: page.thumbnail || null
      };
    });
};

const main = async () => {
  console.log(`Fetching longest pages from Wikipedia (limit ${LONGPAGE_LIMIT})...`);
  const titles = await fetchLongestPages();
  if (!titles.length) {
    throw new Error('No titles returned from Longestpages. Wikipedia may be throttling or blocking; try again later.');
  }
  console.log(`Received ${titles.length} titles; fetching article details...`);

  const allPages = [];
  for (let i = 0; i < titles.length; i += CHUNK_SIZE) {
    const batch = titles.slice(i, i + CHUNK_SIZE);
    const pages = await fetchPageDetails(batch);
    allPages.push(...pages);
    process.stdout.write(`Processed ${Math.min(i + CHUNK_SIZE, titles.length)} / ${titles.length} titles\r`);
  }
  process.stdout.write('\n');

  const deduped = new Map();
  for (const page of allPages) {
    if (!isLikelyBiography(page.categories || [])) continue;
    const key = page.title.toLowerCase();
    const existing = deduped.get(key);
    if (!existing || (page.length || 0) > (existing.length || 0)) {
      deduped.set(key, page);
    }
  }

  const sorted = Array.from(deduped.values())
    .filter((p) => (p.length || 0) > 0)
    .sort((a, b) => {
      const len = (b.length || 0) - (a.length || 0);
      if (len !== 0) return len;
      const pv = (b.pageviews || 0) - (a.pageviews || 0);
      if (pv !== 0) return pv;
      return a.title.localeCompare(b.title);
    })
    .slice(0, OUTPUT_COUNT);

  await fs.mkdir('public', { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(sorted, null, 2), 'utf8');
  console.log(`Wrote ${sorted.length} biographies to ${OUTPUT_PATH}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
