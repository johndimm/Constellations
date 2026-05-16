/* eslint-disable @typescript-eslint/no-explicit-any */
type VercelRequest = { query: Record<string, string | string[]> }
type VercelResponse = { setHeader(k: string, v: string): void; json(body: any): void }

const WIKI_UA = 'Constellations/1.0 (knowledge graph; +https://www.mediawiki.org/wiki/API:Etiquette)'

async function wikiGet(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA } })
  if (!res.ok) return null
  try { return await res.json() } catch { return null }
}

function isScreenWork(context: string, title: string): boolean {
  return /\b(film|movie|television series|tv series|miniseries|sitcom|drama|comedy series|series|show)\b/i.test(
    `${context} ${title}`
  )
}

function isPerson(context: string): boolean {
  return /\b(person|actor|actress|director|musician|singer|artist|rapper|songwriter|composer|author|writer|poet|politician|athlete|model|dancer|band|group)\b/i.test(context)
}

async function fetchPageImage(title: string): Promise<{ url: string | null; pageTitle?: string; pageId?: number }> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(title)}&pithumbsize=800&redirects=1&origin=*`
  const data = await wikiGet(url)
  const pages = data?.query?.pages ?? {}
  for (const page of Object.values(pages) as any[]) {
    if (page.thumbnail?.source) {
      return { url: page.thumbnail.source, pageTitle: page.title, pageId: page.pageid }
    }
  }
  return { url: null }
}

async function fetchWikidataImage(title: string): Promise<string | null> {
  try {
    const ppUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}&redirects=1&origin=*`
    const ppData = await wikiGet(ppUrl)
    const pages = ppData?.query?.pages ?? {}
    let qid: string | null = null
    for (const page of Object.values(pages) as any[]) {
      const q = page?.pageprops?.wikibase_item
      if (q && /^Q\d+$/.test(q)) { qid = q; break }
    }
    if (!qid) return null

    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qid}&origin=*`
    const wdData = await wikiGet(wdUrl)
    const p18 = wdData?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined
    if (!p18) return null

    const fileTitle = p18.startsWith('File:') ? p18 : `File:${p18}`
    const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=800&origin=*`
    const infoData = await wikiGet(infoUrl)
    const infoPages = infoData?.query?.pages ?? {}
    for (const p of Object.values(infoPages) as any[]) {
      const info = p?.imageinfo?.[0]
      if (info?.thumburl || info?.url) return info.thumburl || info.url
    }
  } catch { /* ignore */ }
  return null
}

async function fetchPosterFromArticleImages(title: string): Promise<string | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&titles=${encodeURIComponent(title)}&imlimit=50&redirects=1&origin=*`
    const data = await wikiGet(url)
    const pages = data?.query?.pages ?? {}
    let images: string[] = []
    for (const page of Object.values(pages) as any[]) {
      images = (page?.images ?? []).map((i: any) => String(i?.title || ''))
    }
    if (!images.length) return null

    const normalizedTitle = title.toLowerCase()
    const scored = images
      .filter(t => t.toLowerCase().startsWith('file:'))
      .map(t => {
        const lt = t.toLowerCase()
        let score = 0
        if (lt.includes('poster')) score += 500
        if (lt.includes('cover')) score += 200
        if (lt.includes('film') || lt.includes('movie')) score += 150
        if (lt.includes(normalizedTitle)) score += 200
        if (lt.includes('.svg') || lt.includes('.webm') || lt.includes('.gif')) score -= 300
        if (t.length > 100) score -= 400
        return { title: t, score }
      })
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    if (!best || best.score <= 0) return null

    const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(best.title)}&iiprop=url&iiurlwidth=800&origin=*`
    const infoData = await wikiGet(infoUrl)
    const infoPages = infoData?.query?.pages ?? {}
    for (const p of Object.values(infoPages) as any[]) {
      const info = p?.imageinfo?.[0]
      if (info?.thumburl || info?.url) return info.thumburl || info.url
    }
  } catch { /* ignore */ }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const title = (typeof req.query.title === 'string' ? req.query.title : '').trim()
  const context = (typeof req.query.context === 'string' ? req.query.context : '').trim()

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate')

  if (!title) return res.json({ url: null })

  try {
    const screen = isScreenWork(context, title)
    const person = isPerson(context)

    if (person) {
      const r = await fetchPageImage(title)
      if (r.url) return res.json(r)
      const wdUrl = await fetchWikidataImage(title)
      if (wdUrl) return res.json({ url: wdUrl, source: 'wikidata' })
      return res.json({ url: null })
    }

    if (screen) {
      const posterUrl = await fetchPosterFromArticleImages(title)
      if (posterUrl) return res.json({ url: posterUrl, source: 'enwiki-images' })
      const wdUrl = await fetchWikidataImage(title)
      if (wdUrl) return res.json({ url: wdUrl, source: 'wikidata' })
      const r = await fetchPageImage(title)
      if (r.url) return res.json(r)
      return res.json({ url: null })
    }

    const r = await fetchPageImage(title)
    if (r.url) return res.json(r)
    const wdUrl = await fetchWikidataImage(title)
    if (wdUrl) return res.json({ url: wdUrl, source: 'wikidata' })
    return res.json({ url: null })
  } catch {
    return res.json({ url: null })
  }
}
