import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/johndimm/projects/Constellations";
const PAPER_DIR = path.join(ROOT, "public", "paper");
const OUT_DIR = path.join(PAPER_DIR, "rendered");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = `Command failed: ${cmd} ${args.join(" ")} (exit=${res.status})`;
    throw new Error(msg);
  }
}

function findChromeBinary() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
    "chromium-browser"
  ];
  for (const c of candidates) {
    try {
      if (c.startsWith("/")) {
        if (fs.existsSync(c)) return c;
      } else {
        const r = spawnSync("which", [c], { encoding: "utf8" });
        if (r.status === 0 && (r.stdout || "").trim()) return c;
      }
    } catch { }
  }
  return null;
}

function toFileUrl(p) {
  // Minimal file:// URL builder that tolerates spaces.
  return "file://" + encodeURI(p);
}

function main() {
  // 1) Ensure HTML is up to date.
  run("node", [path.join(ROOT, "scripts", "renderPaperMarkdown.mjs")], { cwd: ROOT });

  // 2) Print paper.html to PDF using headless Chrome.
  const chrome = findChromeBinary();
  if (!chrome) {
    throw new Error('Could not find Chrome/Chromium. Install Google Chrome or adjust scripts/renderPaperPdf.mjs.');
  }

  const paperHtml = path.join(OUT_DIR, "paper.html");
  const outPdf = path.join(OUT_DIR, "constellations.pdf");
  if (!fs.existsSync(paperHtml)) {
    throw new Error(`Missing rendered HTML: ${paperHtml}. Run npm run render:paper first.`);
  }

  // Remove any previous PDF so we don't confuse the user if printing fails.
  try { fs.unlinkSync(outPdf); } catch { }

  const args = [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    `--print-to-pdf=${outPdf}`,
    "--virtual-time-budget=8000",
    toFileUrl(paperHtml)
  ];

  console.log(`\n🖨️  Printing PDF via Chrome: ${chrome}`);
  console.log(`📄 Input: ${paperHtml}`);
  console.log(`✅ Output: ${outPdf}\n`);

  run(chrome, args, { cwd: ROOT });

  if (!fs.existsSync(outPdf)) {
    throw new Error(`Expected PDF not found at ${outPdf}`);
  }
  console.log(`Done: ${outPdf}`);
}

main();

