import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, applyProviderFromRequest } from "./_helpers";
import { getPool, upsertNodes, upsertEdge, initSql } from "./_db";
import { fetchConnections, fetchPersonWorks, classifyEntity } from "../services/aiService";
import { fetchWikipediaSummary } from "../services/wikipediaService";
import { fetchAllModels, fetchModelsForProvider } from "../services/modelsService";
import { fetchDuckDuckGoImages } from "../services/resolveImageForTitle";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const action = String(req.query.action || "");

  switch (action) {
    case "expansion":
      return expansionHandler(req, res);
    case "node":
      return nodeHandler(req, res);
    case "db-path":
      return dbPathHandler(req, res);
    case "init":
      return initHandler(req, res);
    case "cache-clear":
      return cacheClearHandler(req, res);
    case "health":
      return res.json({ ok: true });
    case "graphs":
      return graphsHandler(req, res);
    case "models":
      return modelsHandler(req, res);
    case "image":
    case "poster":
      return imageHandler(req, res);
    case "ddg-image-test":
      return ddgImageTestHandler(req, res);
    case "crossref-work":
      return crossrefWorkHandler(req, res);
    case "expand":
      return expandHandler(req, res);
    default:
      return res.status(404).json({ error: `Unknown action: ${action}` });
  }
}

// --- expansion ---

async function expansionHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return expansionGet(req, res);
  if (req.method === "POST") return expansionPost(req, res);
  return res.status(405).json({ error: "Method not allowed" });
}

async function expansionGet(req: VercelRequest, res: VercelResponse) {
  const sourceId = String(req.query.sourceId || "");
  if (!sourceId) return res.status(400).json({ error: "sourceId required" });
  const id = parseInt(sourceId);
  if (isNaN(id)) return res.status(400).json({ error: "sourceId must be a number" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(
      `select n.*, e.label as edge_label, e.meta as edge_meta
       from nodes n
       join edges e on (
         (e.atomic_id = $1 and e.composite_id = n.id)
         or (e.composite_id = $1 and e.atomic_id = n.id)
       )
       where n.id != $1`,
      [id]
    );

    if (result.rowCount && result.rowCount > 0) {
      return res.json({
        hit: "exact",
        targets: result.rows.map((r: any) => r.id),
        nodes: result.rows.map((r: any) => {
          const m = r.meta || {};
          const mergedMeta = { ...m };
          if (!mergedMeta.imageUrl && r.image_url) mergedMeta.imageUrl = r.image_url;
          if (!mergedMeta.wikiSummary && r.wiki_summary) mergedMeta.wikiSummary = r.wiki_summary;
          return {
            ...r,
            meta: mergedMeta,
            imageUrl: r.image_url,
            wikiSummary: r.wiki_summary,
            is_atomic: r.is_atomic ?? r.type?.toLowerCase() === "person",
            is_person: r.is_atomic ?? r.type?.toLowerCase() === "person",
            edge_label: r.edge_label ?? null,
            edge_meta: r.edge_meta ?? null,
          };
        }),
      });
    }
    return res.json({ hit: "miss" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function expansionPost(req: VercelRequest, res: VercelResponse) {
  const { sourceId, nodes } = req.body || {};
  if (!sourceId || !nodes) return res.status(400).json({ error: "sourceId and nodes required" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const sourceRes = await client.query("select is_atomic, type from nodes where id = $1", [sourceId]);
    if (sourceRes.rowCount === 0) {
      await client.query("rollback");
      return res.json({ ok: true, skipped: true, reason: "source node not in db" });
    }
    const sourceIsAtomic = sourceRes.rows[0].is_atomic ?? sourceRes.rows[0].type?.toLowerCase() === "person";

    const nodeMap = await upsertNodes(client, nodes);

    for (const n of nodes) {
      const normalizedWikiId = (n.wikipedia_id || n.wikipediaId || "").toString().trim();
      const key = `${normalizedWikiId}|${(n.title || n.id || "").toString().toLowerCase()}|${(n.type || "").toString().toLowerCase()}`;
      const dbNode = nodeMap.get(key);
      if (!dbNode) continue;

      const targetId = dbNode.id;
      const [atomicId, compositeId] = sourceIsAtomic ? [sourceId, targetId] : [targetId, sourceId];
      await upsertEdge(client, atomicId, compositeId, n.edge_label || n.label, n.edge_meta || n.meta_edge);
    }

    await client.query("commit");
    return res.json({ ok: true });
  } catch (e: any) {
    await client.query("rollback").catch(() => {});
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

// --- node ---

async function nodeHandler(req: VercelRequest, res: VercelResponse) {
  const node = req.body as { title?: string; type?: string; description?: string | null; year?: number | null; meta?: any; wikipedia_id?: string };
  if (!node?.title && !(node as any)?.id) return res.status(400).json({ error: "title required" });
  if (!node?.type) return res.status(400).json({ error: "type required" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const nodeMap = await upsertNodes(client, [{
      title: node.title || (node as any).id,
      type: node.type,
      description: node.description ?? null,
      year: node.year ?? null,
      meta: node.meta ?? {},
      wikipedia_id: node.wikipedia_id ?? null,
    }]);
    await client.query("COMMIT");

    const title = node.title || (node as any).id || "";
    const type = node.type || "";
    const wikiId = (node.wikipedia_id || "").toString().trim();
    const key = `${wikiId}|${title.toLowerCase()}|${type.toLowerCase()}`;
    const dbNode = nodeMap.get(key);
    return res.json({ ok: true, id: dbNode?.id, ...dbNode });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

// --- db-path ---

async function dbPathHandler(req: VercelRequest, res: VercelResponse) {
  const startId = String(req.query.startId || "");
  const endId = String(req.query.endId || "");
  const maxDepth = parseInt(String(req.query.maxDepth || "10"));
  if (!startId || !endId) return res.status(400).json({ error: "startId and endId required" });

  const start = parseInt(startId);
  const end = parseInt(endId);
  if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: "startId and endId must be numbers" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    const visited = new Set<number>();
    const queue: Array<{ nodeId: number; path: number[] }> = [{ nodeId: start, path: [start] }];
    visited.add(start);

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      if (path.length > maxDepth) continue;

      const nodeRes = await client.query("select is_atomic from nodes where id = $1", [nodeId]);
      if (nodeRes.rows.length === 0) continue;
      const isAtomic = nodeRes.rows[0].is_atomic ?? false;

      const neighborsRes = await client.query(
        isAtomic
          ? `select composite_id as neighbor_id from edges where atomic_id = $1`
          : `select atomic_id as neighbor_id from edges where composite_id = $1`,
        [nodeId]
      );

      for (const row of neighborsRes.rows) {
        const neighborId = row.neighbor_id;
        if (neighborId === end) {
          const fullPath = [...path, neighborId];
          const nodesRes = await client.query(
            `select * from nodes where id = ANY($1::int[])`,
            [fullPath]
          );
          const nodeMap = new Map(nodesRes.rows.map((r: any) => [r.id, r]));
          const pathNodes = fullPath
            .map((id) => {
              const node = nodeMap.get(id) as any;
              if (!node) return null;
              const m = node.meta || {};
              const mergedMeta = { ...m };
              if (!mergedMeta.imageUrl && node.image_url) mergedMeta.imageUrl = node.image_url;
              if (!mergedMeta.wikiSummary && node.wiki_summary) mergedMeta.wikiSummary = node.wiki_summary;
              return {
                ...node,
                meta: mergedMeta,
                imageUrl: node.image_url,
                wikiSummary: node.wiki_summary,
                is_atomic: node.is_atomic ?? node.type?.toLowerCase() === "person",
              };
            })
            .filter(Boolean);
          return res.json({ path: pathNodes, found: true });
        }
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ nodeId: neighborId, path: [...path, neighborId] });
        }
      }
    }
    return res.json({ path: [], found: false });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

// --- init ---

async function initHandler(_req: VercelRequest, res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("drop table if exists edges cascade");
    await client.query("drop table if exists nodes cascade");
    await client.query("drop table if exists saved_graphs cascade");
    await client.query(initSql);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

// --- cache/clear ---

async function cacheClearHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const edgesResult = await client.query("DELETE FROM edges");
    const nodesResult = await client.query("DELETE FROM nodes");
    await client.query("COMMIT");
    return res.json({
      ok: true,
      message: "Cache cleared successfully",
      deleted: { nodes: nodesResult.rowCount || 0, edges: edgesResult.rowCount || 0 },
    });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

// --- graphs ---

async function graphsHandler(req: VercelRequest, res: VercelResponse) {
  const name = req.query.name ? String(req.query.name) : null;

  if (name) {
    if (req.method === "DELETE") return graphDelete(name, res);
    return graphGet(name, res);
  }

  if (req.method === "GET") return graphsList(res);
  if (req.method === "POST") return graphsSave(req, res);
  return res.status(405).json({ error: "Method not allowed" });
}

async function graphsList(res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query("select name, updated_at from saved_graphs order by name asc");
    return res.json(result.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function graphsSave(req: VercelRequest, res: VercelResponse) {
  const { name, data } = req.body || {};
  if (!name || !data) return res.status(400).json({ error: "name and data required" });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(
      `insert into saved_graphs (name, data, updated_at) values ($1, $2, now())
       on conflict (name) do update set data = excluded.data, updated_at = now()`,
      [name, data]
    );
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function graphGet(name: string, res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query("select data from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    return res.json(result.rows[0].data);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function graphDelete(name: string, res: VercelResponse) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query("delete from saved_graphs where name = $1", [name]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Graph not found" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

// --- models ---

async function modelsHandler(req: VercelRequest, res: VercelResponse) {
  const provider = typeof req.query.provider === "string" ? req.query.provider : null;
  try {
    const models = provider ? await fetchModelsForProvider(provider) : await fetchAllModels();
    return res.json({ models });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "models fetch failed" });
  }
}

// --- image / poster ---

const WIKI_UA = "Constellations/1.0 (knowledge graph; +https://www.mediawiki.org/wiki/API:Etiquette)";

async function wikiGet(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": WIKI_UA } });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

function isScreenWork(context: string, title: string): boolean {
  return /\b(film|movie|television series|tv series|miniseries|sitcom|drama|comedy series|series|show)\b/i.test(
    `${context} ${title}`
  );
}

function isPersonContext(context: string): boolean {
  return /\b(person|actor|actress|director|musician|singer|artist|rapper|songwriter|composer|author|writer|poet|politician|athlete|model|dancer|band|group)\b/i.test(context);
}

async function fetchPageImage(title: string): Promise<{ url: string | null; pageTitle?: string; pageId?: number }> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(title)}&pithumbsize=800&redirects=1&origin=*`;
  const data = await wikiGet(url);
  const pages = data?.query?.pages ?? {};
  for (const page of Object.values(pages) as any[]) {
    if (page.thumbnail?.source) {
      return { url: page.thumbnail.source, pageTitle: page.title, pageId: page.pageid };
    }
  }
  return { url: null };
}

async function fetchWikidataImage(title: string): Promise<string | null> {
  try {
    const ppUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}&redirects=1&origin=*`;
    const ppData = await wikiGet(ppUrl);
    const pages = ppData?.query?.pages ?? {};
    let qid: string | null = null;
    for (const page of Object.values(pages) as any[]) {
      const q = page?.pageprops?.wikibase_item;
      if (q && /^Q\d+$/.test(q)) { qid = q; break; }
    }
    if (!qid) return null;

    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qid}&origin=*`;
    const wdData = await wikiGet(wdUrl);
    const p18 = wdData?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
    if (!p18) return null;

    const fileTitle = p18.startsWith("File:") ? p18 : `File:${p18}`;
    const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}&iiprop=url&iiurlwidth=800&origin=*`;
    const infoData = await wikiGet(infoUrl);
    const infoPages = infoData?.query?.pages ?? {};
    for (const p of Object.values(infoPages) as any[]) {
      const info = p?.imageinfo?.[0];
      if (info?.thumburl || info?.url) return info.thumburl || info.url;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchPosterFromArticleImages(title: string): Promise<string | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&titles=${encodeURIComponent(title)}&imlimit=50&redirects=1&origin=*`;
    const data = await wikiGet(url);
    const pages = data?.query?.pages ?? {};
    let images: string[] = [];
    for (const page of Object.values(pages) as any[]) {
      images = (page?.images ?? []).map((i: any) => String(i?.title || ""));
    }
    if (!images.length) return null;

    const normalizedTitle = title.toLowerCase();
    const scored = images
      .filter(t => t.toLowerCase().startsWith("file:"))
      .map(t => {
        const lt = t.toLowerCase();
        let score = 0;
        if (lt.includes("poster")) score += 500;
        if (lt.includes("cover")) score += 200;
        if (lt.includes("film") || lt.includes("movie")) score += 150;
        if (lt.includes(normalizedTitle)) score += 200;
        if (lt.includes(".svg") || lt.includes(".webm") || lt.includes(".gif")) score -= 300;
        if (t.length > 100) score -= 400;
        return { title: t, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score <= 0) return null;

    const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(best.title)}&iiprop=url&iiurlwidth=800&origin=*`;
    const infoData = await wikiGet(infoUrl);
    const infoPages = infoData?.query?.pages ?? {};
    for (const p of Object.values(infoPages) as any[]) {
      const info = p?.imageinfo?.[0];
      if (info?.thumburl || info?.url) return info.thumburl || info.url;
    }
  } catch { /* ignore */ }
  return null;
}

async function imageHandler(req: VercelRequest, res: VercelResponse) {
  const title = (typeof req.query.title === "string" ? req.query.title : "").trim();
  const context = (typeof req.query.context === "string" ? req.query.context : "").trim();

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

  if (!title) return res.json({ url: null });

  try {
    const screen = isScreenWork(context, title);
    const person = isPersonContext(context);

    if (person) {
      const r = await fetchPageImage(title);
      if (r.url) return res.json(r);
      const wdUrl = await fetchWikidataImage(title);
      if (wdUrl) return res.json({ url: wdUrl, source: "wikidata" });
      return res.json({ url: null });
    }

    if (screen) {
      const posterUrl = await fetchPosterFromArticleImages(title);
      if (posterUrl) return res.json({ url: posterUrl, source: "enwiki-images" });
      const wdUrl = await fetchWikidataImage(title);
      if (wdUrl) return res.json({ url: wdUrl, source: "wikidata" });
      const r = await fetchPageImage(title);
      if (r.url) return res.json(r);
      return res.json({ url: null });
    }

    const r = await fetchPageImage(title);
    if (r.url) return res.json(r);
    const wdUrl = await fetchWikidataImage(title);
    if (wdUrl) return res.json({ url: wdUrl, source: "wikidata" });
    return res.json({ url: null });
  } catch {
    return res.json({ url: null });
  }
}

// --- ddg-image-test ---

async function ddgImageTestHandler(req: VercelRequest, res: VercelResponse) {
  const q = String(req.query.title || req.query.q || "").trim();
  const limit = Number(req.query.limit || 10);
  if (!q) return res.status(400).json({ error: "title (or q) is required" });
  const results = await fetchDuckDuckGoImages(q, isNaN(limit) ? 10 : limit);
  return res.json({ query: q, count: results.length, results });
}

// --- crossref/work ---

async function crossrefWorkHandler(req: VercelRequest, res: VercelResponse) {
  const doiRaw = String(req.query.doi || "").trim();
  if (!doiRaw) return res.status(400).json({ error: "doi required" });
  const doi = doiRaw.replace(/^https?:\/\/doi\.org\//i, "");
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `Crossref error: ${r.status} ${r.statusText}`, body: text.slice(0, 2000) });
    }
    const json = await r.json();
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    return res.json(json);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Crossref request failed" });
  }
}

// --- expand ---

async function expandHandler(req: VercelRequest, res: VercelResponse) {
  applyProviderFromRequest(req.body);
  const { query, context, atomicType, compositeType } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const wiki = await fetchWikipediaSummary(query, context);
    let isAtomic = (atomicType || "").toLowerCase() === "person";
    let type = atomicType;

    if (!type) {
      const classification = await classifyEntity(query, wiki.extract || undefined);
      isAtomic = classification.isAtomic;
      type = classification.type;
    }

    let data;
    if (isAtomic) {
      data = await fetchPersonWorks(query, [], wiki.extract || undefined, wiki.pageid?.toString(), atomicType, compositeType, wiki.mentioningPageTitles || undefined);
    } else {
      data = await fetchConnections(query, context, [], wiki.extract || undefined, wiki.pageid?.toString(), atomicType, compositeType, wiki.mentioningPageTitles || undefined);
    }

    return res.json({ query, wiki, type, isAtomic, data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
