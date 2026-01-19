import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/johndimm/projects/Constellations";
const PAPER_DIR = path.join(ROOT, "public", "paper");
const OUT_DIR = path.join(PAPER_DIR, "rendered");

function esc(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveAssetUrl(url) {
  const u = String(url || "").trim();
  // When opening rendered HTML via file://, root-absolute paths like "/beef.png" break.
  // The rendered files live at: public/paper/rendered/*.html
  // Assets live at: public/<asset>
  // So rewrite "/asset" -> "../../asset"
  if (u.startsWith("/") && !u.startsWith("//")) return `../../${u.slice(1)}`;
  return u;
}

function inline(md) {
  // images ![alt](url) (inline form; block images handled in mdToHtml)
  // Support URLs wrapped in <...> to allow spaces.
  let s = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, urlRaw) => {
    let url = String(urlRaw).trim();
    if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
    url = resolveAssetUrl(url);
    const safeAlt = esc(String(alt || "").trim());
    const safeUrl = esc(url);
    return `<img src="${safeUrl}" alt="${safeAlt}" />`;
  });
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, urlRaw) => {
    let url = String(urlRaw).trim();
    if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
    url = resolveAssetUrl(url);
    const safeText = esc(text);
    const safeUrl = esc(url);
    const isExternal = /^https?:\/\//i.test(url);
    const attrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${safeUrl}"${attrs}>${safeText}</a>`;
  });
  // inline code `code`
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${esc(code)}</code>`);
  // simple emphasis **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<b>${esc(t)}</b>`);
  return s;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let out = [];
  let inList = false;
  let inCode = false;
  let codeBuf = [];

  const flushList = () => {
    if (inList) out.push("</ul>");
    inList = false;
  };

  const flushCode = () => {
    if (!inCode) return;
    out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
    inCode = false;
    codeBuf = [];
  };

  for (let raw of lines) {
    const line = raw;

    // fenced code block
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
      } else {
        flushList();
        inCode = true;
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      continue;
    }

    // standalone image line: ![alt](url){width=60%}
    // Render as a figure with optional caption (alt text) and optional width.
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*(\{[^}]+\})?\s*$/);
    if (img) {
      flushList();
      let url = String(img[2]).trim();
      if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
      url = resolveAssetUrl(url);
      const safeUrl = esc(url);
      const alt = String(img[1] || "").trim();
      const safeAlt = esc(alt);

      // parse {width=...}
      let styleAttr = "";
      const brace = img[3] ? String(img[3]) : "";
      const widthMatch = brace.match(/width\s*=\s*([0-9]+%|[0-9.]+(px|rem|em))\b/i);
      if (widthMatch) {
        styleAttr = ` style="max-width:${esc(widthMatch[1])};"`;
      }

      out.push(
        `<figure><img src="${safeUrl}" alt="${safeAlt}"${styleAttr} />${alt ? `<figcaption>${esc(alt)}</figcaption>` : ""}</figure>`
      );
      continue;
    }

    // list items
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li) {
      if (!inList) {
        flushCode();
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1].trim())}</li>`);
      continue;
    }

    // blank line
    if (!line.trim()) {
      flushList();
      continue;
    }

    // paragraph
    flushList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }

  flushList();
  flushCode();
  return out.join("\n");
}

function pageTemplate({ title, bodyHtml, navHtml }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>
      :root {
        --bg: #0b1220;
        --card: rgba(15, 23, 42, 0.72);
        --text: #f1f5f9;
        --muted: #94a3b8;
        --link: #93c5fd;
        --linkHover: #bfdbfe;
        --border: rgba(148, 163, 184, 0.25);
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        background: radial-gradient(1200px 800px at 30% 10%, rgba(59,130,246,0.18), transparent 60%),
                    radial-gradient(1000px 700px at 75% 30%, rgba(245,158,11,0.12), transparent 55%),
                    var(--bg);
        color: var(--text);
        line-height: 1.6;
      }
      a { color: var(--link); text-decoration: none; }
      a:hover { color: var(--linkHover); text-decoration: underline; }
      code { background: rgba(148,163,184,0.14); padding: 2px 6px; border-radius: 8px; }
      pre { background: rgba(2,6,23,0.45); border: 1px solid var(--border); padding: 12px; border-radius: 12px; overflow: auto; }
      h1,h2,h3 { line-height: 1.25; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 26px 18px 70px; }
      .nav {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 10px 14px;
        margin: 14px 0 18px;
        color: var(--muted);
        font-size: 13px;
      }
      .nav a { margin-right: 10px; }
      .content {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 18px 18px;
      }
      ul { margin: 10px 0; padding-left: 20px; }
      p { margin: 10px 0; }
      figure { margin: 14px 0 18px; text-align: center; }
      img {
        max-width: 56%;
        height: auto;
        border-radius: 12px;
        border: 1px solid var(--border);
        display: block;
        margin: 0 auto;
      }
      figcaption { color: var(--muted); font-size: 12px; margin-top: 6px; text-align: center; }
      video { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--border); }

      /* Print-friendly: black on white, no dark backgrounds */
      @media print {
        @page {
          size: letter;
          margin: 0.75in;
        }
        :root {
          --bg: #ffffff;
          --card: #ffffff;
          --text: #000000;
          --muted: #333333;
          --link: #000000;
          --linkHover: #000000;
          --border: rgba(0, 0, 0, 0.2);
        }
        body { background: #ffffff !important; color: #000000 !important; }
        body {
          font-family: "Times New Roman", Times, serif !important;
          font-size: 10pt !important;
          line-height: 1.35 !important;
        }
        .nav { display: none !important; }
        .wrap { max-width: none !important; padding: 0 !important; }
        .content { border: none !important; background: #ffffff !important; padding: 0 !important; }
        a { text-decoration: underline !important; }
        pre { background: #ffffff !important; }
        figure { break-inside: avoid; page-break-inside: avoid; }
        img { border: 1px solid rgba(0,0,0,0.15) !important; max-width: 100% !important; border-radius: 4px !important; }
        video { display: none !important; }

        /* Academic two-column layout for paper.html */
        .paper-two-col {
          column-count: 2;
          column-gap: 0.28in;
          column-fill: auto;
        }
        .paper-header {
          column-span: all;
          margin-bottom: 10pt;
        }
        .paper-header h1 { margin: 0 0 6pt 0; font-size: 16pt; }
        .paper-header p { margin: 0 0 4pt 0; }
        h2 { font-size: 12pt; margin: 10pt 0 4pt; }
        h3 { font-size: 11pt; margin: 8pt 0 3pt; }
        p { text-align: justify; }
        h2, h3 { break-after: avoid; page-break-after: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="nav">${navHtml}</div>
      <div class="content">
        ${bodyHtml}
      </div>
    </div>
  </body>
</html>`;
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function main() {
  ensureDir(OUT_DIR);

  const files = fs
    .readdirSync(PAPER_DIR)
    .filter((f) => f.endsWith(".md") && f !== "index.md" && f !== "05-evaluation-plan.md")
    .sort();

  const navLinks = [
    `<a href="./index.html">Paper Index</a>`,
    `<a href="../index.html">Raw Index (HTML)</a>`,
    `<a href="../../bibliography.html">Bibliography</a>`,
  ].join(" ");

  // Render each section
  for (const f of files) {
    const md = fs.readFileSync(path.join(PAPER_DIR, f), "utf8");
    const bodyHtml = mdToHtml(md);
    const title = `Constellations — ${f}`;
    const html = pageTemplate({ title, bodyHtml, navHtml: navLinks });
    fs.writeFileSync(path.join(OUT_DIR, f.replace(/\.md$/, ".html")), html, "utf8");
  }

  // Render a single printable paper.html (concatenated sections in order)
  const printOrder = [
    "01-abstract.md",
    "02-introduction.md",
    "03-related-work.md",
    "04-system.md",
    "06-discussion-future-work.md",
    "07-references.md",
    "08-acknowledgements.md",
  ].filter((f) => fs.existsSync(path.join(PAPER_DIR, f)));

  const paperTitle = "Constellations: Low-Friction Exploratory Navigation with Evidence-Backed Bipartite Graphs";
  const paperMeta = `
    <div class="paper-header">
      <h1>${esc(paperTitle)}</h1>
      <p><b>John Dimm</b> · Lean Software Development · Draft for discussion</p>
      <p style="color: var(--muted); margin-top: -2px;">Source: <code>public/paper/*.md</code> · Generated: <code>npm run render:paper</code></p>
      <hr style="border: 0; border-top: 1px solid var(--border); margin: 10pt 0 10pt;" />
    </div>
  `;

  const paperBody = `<div class="paper-two-col">${
    [
      paperMeta,
      ...printOrder.map((f) => mdToHtml(fs.readFileSync(path.join(PAPER_DIR, f), "utf8"))),
    ].join("\n")
  }</div>`;

  fs.writeFileSync(
    path.join(OUT_DIR, "paper.html"),
    pageTemplate({ title: paperTitle, bodyHtml: paperBody, navHtml: navLinks }),
    "utf8"
  );

  // Render rendered/index.html
  const indexBody = [
    "<h1>Constellations — Paper Draft</h1>",
    "<p>This is the rendered HTML view of the Markdown draft. Edit the source in <code>public/paper/*.md</code>, then run <code>npm run render:paper</code> to regenerate.</p>",
    '<p><b>Printable:</b> <a href="./paper.html">paper.html</a></p>',
    "<h2>Sections</h2>",
    "<ul>",
    ...files.map((f) => {
      const outName = f.replace(/\.md$/, ".html");
      return `<li><a href="./${esc(outName)}">${esc(f)}</a></li>`;
    }),
    "</ul>",
  ].join("\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    pageTemplate({ title: "Constellations — Paper Draft (Rendered)", bodyHtml: indexBody, navHtml: navLinks }),
    "utf8"
  );

  console.log(`Rendered ${files.length} markdown files to ${OUT_DIR}`);
}

main();

