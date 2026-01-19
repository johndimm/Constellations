import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/johndimm/projects/Constellations";
const PAPER_DIR = path.join(ROOT, "public", "paper");
const TEX_DIR = path.join(PAPER_DIR, "tex");
const OUT_TEX = path.join(TEX_DIR, "paper.generated.tex");

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

const TOK_LR = "@@LRARROW@@";
const TOK_GE = "@@GE@@";
const TOK_LE = "@@LE@@";

function normalizeUnicode(s) {
  return String(s)
    // Characters that pdfLaTeX doesn't handle reliably in text.
    .replaceAll("↔", TOK_LR)
    .replaceAll("≥", TOK_GE)
    .replaceAll("≤", TOK_LE)
    // Make typography a bit more TeX-friendly.
    .replaceAll("—", "---")
    .replaceAll("–", "--")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("‘", "'")
    .replaceAll("’", "'");
}

function escapeLatexText(s) {
  // Escape LaTeX specials for normal text.
  const escaped = normalizeUnicode(String(s))
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("$", "\\$")
    .replaceAll("&", "\\&")
    .replaceAll("#", "\\#")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("^", "\\^{}")
    .replaceAll("~", "\\~{}");
  return escaped
    .replaceAll(TOK_LR, "\\(\\leftrightarrow\\)")
    .replaceAll(TOK_GE, "\\(\\ge\\)")
    .replaceAll(TOK_LE, "\\(\\le\\)");
}

function escapeLatexUrl(s) {
  // Safer for \href{...}{...} arguments.
  return String(s)
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("%", "\\%")
    .replaceAll("#", "\\#")
    .replaceAll("&", "\\&")
    .replaceAll("_", "\\_")
    .replaceAll("^", "\\^{}")
    .replaceAll("~", "\\~{}");
}

function resolveAssetPath(urlRaw) {
  let u = String(urlRaw || "").trim();
  if (u.startsWith("<") && u.endsWith(">")) u = u.slice(1, -1).trim();
  // Decode %20 etc so it matches filenames on disk.
  try {
    u = decodeURIComponent(u);
  } catch {
    // leave as-is if it's not valid encoding
  }
  // Map "/asset" to "../../asset" (from public/paper/tex to public/)
  if (u.startsWith("/") && !u.startsWith("//")) return `../../${u.slice(1)}`;
  return u;
}

function inline(md) {
  let s = normalizeUnicode(String(md ?? ""));

  // Tokenize inline constructs so we can safely escape the rest.
  const tokens = [];
  const tok = (latex) => {
    const idx = tokens.length;
    tokens.push(String(latex));
    // Avoid characters like "_" that get LaTeX-escaped.
    return `@@TOK${idx}@@`;
  };

  // 1) Code spans `code`
  s = s.replace(/`([^`]+)`/g, (_m, code) => {
    const raw = String(code);
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) return tok(`\\url{${escapeLatexUrl(trimmed)}}`);
    return tok(`\\texttt{${escapeLatexText(raw)}}`);
  });

  // 2) Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, urlRaw) => {
    let url = String(urlRaw).trim();
    if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
    url = resolveAssetPath(url);
    const safeUrl = escapeLatexUrl(url);
    const safeText = escapeLatexText(text);
    return tok(`\\href{${safeUrl}}{${safeText}}`);
  });

  // 3) Escape the remaining plain text
  s = escapeLatexText(s);

  // 4) Bold **...** and italic *...* on already-escaped text
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `\\textbf{${t}}`);
  s = s.replace(/\*([^*]+)\*/g, (_m, t) => `\\emph{${t}}`);

  // 5) Restore tokens
  s = s.replace(/@@TOK(\d+)@@/g, (_m, idxStr) => tokens[Number(idxStr)] ?? "");
  return s;
}

function mdToLatex(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];

  let i = 0;
  let inItemize = false;
  let inEnumerate = false;
  let inCodeBlock = false;
  let inStarSection = false;

  function closeLists() {
    if (inItemize) out.push("\\end{itemize}");
    if (inEnumerate) out.push("\\end{enumerate}");
    inItemize = false;
    inEnumerate = false;
  }

  function closeCode() {
    if (!inCodeBlock) return;
    out.push("\\end{verbatim}");
    inCodeBlock = false;
  }

  function sectionCmd(level, title) {
    const t = String(title || "").trim();
    const isTop = level === 1;
    const shouldStar =
      isTop && (/^references\b/i.test(t) || /^acknowledgements\b/i.test(t));

    if (isTop) inStarSection = shouldStar;

    if (level === 1) return shouldStar ? `\\section*{${escapeLatexText(t)}}` : `\\section{${escapeLatexText(t)}}`;
    if (level === 2) return (inStarSection ? `\\subsection*{${escapeLatexText(t)}}` : `\\subsection{${escapeLatexText(t)}}`);
    if (level === 3) return (inStarSection ? `\\subsubsection*{${escapeLatexText(t)}}` : `\\subsubsection{${escapeLatexText(t)}}`);
    return `\\paragraph{${escapeLatexText(t)}}`;
  }

  // Special-case: first file is "# Abstract" with one paragraph
  // We convert it into an abstract environment and skip the header.
  const isAbstractDoc = /^\s*#\s+Abstract\s*$/im.test(lines.find((l) => l.trim().length) ?? "");
  if (isAbstractDoc) {
    // Consume the first heading line, then collect the next paragraph.
    while (i < lines.length && !lines[i].match(/^#\s+Abstract\s*$/)) i++;
    if (i < lines.length) i++; // skip heading
    // Skip blank lines
    while (i < lines.length && !lines[i].trim()) i++;
    const paraLines = [];
    while (i < lines.length && lines[i].trim()) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push("\\begin{abstract}");
    out.push(inline(paraLines.join(" ").trim()));
    out.push("\\end{abstract}");
    // Continue parsing remaining lines (if any) after abstract paragraph.
  }

  const paraBuf = [];
  const flushPara = () => {
    if (!paraBuf.length) return;
    out.push(inline(paraBuf.join(" ").trim()));
    paraBuf.length = 0;
  };

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw;
    const trimmed = line.trim();

    // fenced code block
    if (trimmed.startsWith("```")) {
      flushPara();
      closeLists();
      if (inCodeBlock) closeCode();
      else {
        inCodeBlock = true;
        out.push("\\begin{verbatim}");
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(line);
      continue;
    }

    // headings
    const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      closeLists();
      const level = h[1].length;
      const title = h[2].trim();
      out.push(sectionCmd(level, title));
      continue;
    }

    // standalone image line: ![alt](url){...}
    const img = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*(\{[^}]+\})?\s*$/);
    if (img) {
      flushPara();
      closeLists();
      const alt = String(img[1] || "").trim();
      const url = resolveAssetPath(img[2]);
      out.push("\\begin{figure}[t]");
      out.push("\\centering");
      out.push(`\\includegraphics[width=\\columnwidth]{\\detokenize{${url}}}`);
      if (alt) out.push(`\\caption{${escapeLatexText(alt)}}`);
      out.push("\\end{figure}");
      continue;
    }

    // ordered list item
    const oli = trimmed.match(/^\d+\.\s+(.*)$/);
    if (oli) {
      flushPara();
      if (!inEnumerate) {
        closeLists();
        out.push("\\begin{enumerate}[leftmargin=*]");
        inEnumerate = true;
      }
      out.push(`\\item ${inline(oli[1].trim())}`);
      continue;
    }

    // unordered list item
    const li = trimmed.match(/^-+\s+(.*)$/);
    if (li) {
      flushPara();
      if (!inItemize) {
        closeLists();
        out.push("\\begin{itemize}[leftmargin=*]");
        inItemize = true;
      }
      out.push(`\\item ${inline(li[1].trim())}`);
      continue;
    }

    // blank line
    if (!trimmed) {
      flushPara();
      closeLists();
      continue;
    }

    // paragraph continuation
    paraBuf.push(trimmed);
  }

  flushPara();
  closeLists();
  closeCode();

  return out.join("\n\n") + "\n";
}

function main() {
  ensureDir(TEX_DIR);

  const printOrder = [
    "01-abstract.md",
    "02-introduction.md",
    "03-related-work.md",
    "04-system.md",
    "06-discussion-future-work.md",
    "07-references.md",
    "08-acknowledgements.md",
  ].filter((f) => fs.existsSync(path.join(PAPER_DIR, f)));

  const chunks = [];
  for (const f of printOrder) {
    const md = fs.readFileSync(path.join(PAPER_DIR, f), "utf8");
    chunks.push(`% ---- ${f} ----\n` + mdToLatex(md));
  }

  fs.writeFileSync(OUT_TEX, chunks.join("\n"), "utf8");
  console.log(`Rendered ${printOrder.length} markdown files to ${OUT_TEX}`);
}

main();

