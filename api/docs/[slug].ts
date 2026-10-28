import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "fs";
import path from "path";

const DOC_STYLE = `<style>body{font-family:ui-monospace,monospace;max-width:900px;margin:2rem auto;padding:0 1.5rem 4rem;background:#0f172a;color:#e2e8f0;line-height:1.6}h1,h2,h3{color:#f1f5f9;margin-top:2rem}h1{color:#c084fc}code{background:#1e293b;padding:.1em .35em;border-radius:3px;font-size:.9em}pre code{background:none;padding:0}pre{background:#1e293b;padding:1rem;border-radius:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word}a{color:#818cf8}hr{border-color:#334155}table{border-collapse:collapse;width:100%}td,th{border:1px solid #334155;padding:.4rem .7rem;text-align:left}th{background:#1e293b}</style>`;

const slugMap: Record<string, { file: string; title: string }> = {
  about: { file: "CLAUDE.md", title: "About — Constellations" },
  prompt: { file: "PROMPT.md", title: "Prompt — Constellations" },
  journal: { file: "DEV_JOURNAL.md", title: "Dev Journal — Constellations" },
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug || "");
  const entry = slugMap[slug];
  if (!entry) return res.status(404).json({ error: "Not found" });

  const filePath = path.join(process.cwd(), entry.file);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const html = raw
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/```[\s\S]*?```/g, (m: string) => `<pre><code>${m.slice(3, m.lastIndexOf("```")).replace(/^[a-z]*\n/, "")}</code></pre>`)
      .replace(/^#{3} (.+)$/gm, "<h3>$1</h3>")
      .replace(/^#{2} (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^---$/gm, "<hr>")
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (m: string) => `<ul>${m}</ul>`)
      .replace(/\n\n/g, "</p><p>");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${entry.title}</title>${DOC_STYLE}</head><body><p>${html}</p></body></html>`);
  } catch {
    return res.status(404).json({ error: "Not found" });
  }
}
