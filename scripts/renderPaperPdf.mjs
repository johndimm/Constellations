import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/johndimm/projects/Constellations";
const PAPER_HTML = path.join(ROOT, "public", "paper", "rendered", "paper.html");
const OUT_PDF = path.join(ROOT, "public", "paper", "rendered", "paper.pdf");
const USER_DATA_DIR = path.join(ROOT, ".chrome-pdf-profile");

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(
      "Could not find Google Chrome. Set CHROME_PATH or install Chrome to generate a PDF."
    );
    process.exit(1);
  }

  if (!fs.existsSync(PAPER_HTML)) {
    console.error(`Missing rendered HTML: ${PAPER_HTML}\nRun: npm run render:paper`);
    process.exit(1);
  }

  // Ensure Chrome does not touch system profile/crashpad locations (important under sandboxing).
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const fileUrl = `file://${PAPER_HTML}`;
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${USER_DATA_DIR}`,
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--print-to-pdf-no-header",
    `--print-to-pdf=${OUT_PDF}`,
    fileUrl,
  ];

  const res = spawnSync(chrome, args, { stdio: "inherit" });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }

  console.log(`Wrote ${OUT_PDF}`);
}

main();

