/**
 * Integration test: POST /api/ai/works against a deployed cache server (e.g. Render).
 *
 * Usage:
 *   npx tsx scripts/test_render_works.ts
 *   CLASSIFY_BASE_URL=https://your-service.onrender.com npx tsx scripts/test_render_works.ts
 *   WORKS_NODE_NAME="Marie Curie" npx tsx scripts/test_render_works.ts
 *
 * Expects HTTP 200 and JSON { works: WorkItem[] }. Each work must include entity + type when non-empty.
 * Empty works is valid when the LLM layer degrades (quota, keys, etc.).
 */

const DEFAULT_BASE = "https://constellations-beaf.onrender.com";

function getBase(): string {
  return (
    process.env.CLASSIFY_BASE_URL ||
    process.env.RENDER_CLASSIFY_BASE_URL ||
    process.env.WORKS_BASE_URL ||
    process.env.VITE_CACHE_URL ||
    DEFAULT_BASE
  ).replace(/\/$/, "");
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

function isWorkItem(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return typeof o.entity === "string" && typeof o.type === "string";
}

function isWorksResponseShape(x: unknown): x is { works: unknown[] } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.works)) return false;
  for (const w of o.works) {
    if (!isWorkItem(w)) return false;
  }
  return true;
}

async function testMissingNodeName(base: string) {
  const url = `${base}/api/ai/works`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ excludeNodes: [] }),
  });
  const json = (await res.json()) as { error?: string };
  assert(res.status === 400, `Expected 400 for missing nodeName, got ${res.status}`);
  assert(typeof json.error === "string" && json.error.length > 0, "400 body should include error string");
  console.log("OK: missing nodeName returns 400 with error message.");
}

async function testWorksSuccess(base: string) {
  const url = `${base}/api/ai/works`;
  const nodeName = process.env.WORKS_NODE_NAME || "Alan Turing";
  const atomicType = process.env.WORKS_ATOMIC_TYPE || "Person";
  const compositeType = process.env.WORKS_COMPOSITE_TYPE || "Event";

  const body = {
    nodeName,
    excludeNodes: [] as string[],
    atomicType,
    compositeType,
  };

  console.log("POST", url);
  console.log("Body:", JSON.stringify(body));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.error("Non-JSON response:", res.status, text.slice(0, 500));
    process.exit(1);
  }

  console.log("Status:", res.status);
  console.log("Body:", JSON.stringify(json, null, 2));

  if (res.status === 500) {
    const errMsg = typeof (json as any)?.error === "string" ? (json as any).error : text;
    if (errMsg.includes("429") || errMsg.toLowerCase().includes("resource_exhausted")) {
      console.error(
        "\nDiagnosis: upstream returned 429. Redeploy server.ts so /api/ai/works returns HTTP 200 with { works: [] } on failure, " +
          "or set LLM_PROVIDER + keys / Gemini fallback on Render.\n"
      );
    }
    process.exit(1);
  }

  assert(
    res.status === 200,
    `Expected HTTP 200, got ${res.status}. Deploy latest server.ts (works route → sendAiJson + try/catch) or fix CLASSIFY_BASE_URL / WORKS_BASE_URL.`
  );

  assert(isWorksResponseShape(json), 'Response must be { works: Array<{ entity: string, type: string, ... }> }.');

  const count = (json as { works: unknown[] }).works.length;
  console.log(`\nOK: works integration test passed (${count} work(s)).`);
}

async function main() {
  const base = getBase();
  await testMissingNodeName(base);
  await testWorksSuccess(base);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
