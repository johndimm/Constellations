/**
 * Integration test: POST /api/ai/classify-start against a deployed cache server (e.g. Render).
 *
 * Usage:
 *   npx tsx scripts/test_render_classify_start.ts
 *   CLASSIFY_BASE_URL=https://your-service.onrender.com npx tsx scripts/test_render_classify_start.ts
 *
 * Expects HTTP 200 and a JSON body with the same shape as a successful classify-start
 * (type, description, isAtomic, atomicType, compositeType, reasoning).
 */

const DEFAULT_BASE = "https://constellations-beaf.onrender.com";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

function isStartPairShape(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.type === "string" &&
    typeof o.atomicType === "string" &&
    typeof o.compositeType === "string" &&
    typeof o.isAtomic === "boolean" &&
    typeof o.reasoning === "string"
  );
}

async function main() {
  const base = (
    process.env.CLASSIFY_BASE_URL ||
    process.env.RENDER_CLASSIFY_BASE_URL ||
    process.env.VITE_CACHE_URL ||
    DEFAULT_BASE
  )
    .replace(/\/$/, "");

  const url = `${base}/api/ai/classify-start`;
  const term = process.env.CLASSIFY_TERM || "Alan Turing";

  console.log("POST", url);
  console.log("Body:", JSON.stringify({ term }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term }),
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
    const errMsg = typeof (json as any)?.error === "string" ? (json as any).error : "";
    if (errMsg.includes("429") || errMsg.toLowerCase().includes("resource_exhausted")) {
      console.error(
        "\nDiagnosis: upstream Gemini/Vertex returned 429. Redeploy server.ts so /api/ai/classify-start " +
          "returns HTTP 200 with a default Person↔Event payload on failure (see defaultStartPairResult catch). " +
          "Or set LLM_PROVIDER + OpenAI keys on Render so the server does not depend only on Gemini quota.\n"
      );
    }
    process.exit(1);
  }

  assert(
    res.status === 200,
    `Expected HTTP 200, got ${res.status}. Deploy latest server.ts (classify-start catch → 200 + default) or point CLASSIFY_BASE_URL at a fixed server.`
  );

  assert(isStartPairShape(json), "Response must match classify-start shape (type, atomicType, compositeType, isAtomic, reasoning).");

  console.log("\nOK: classify-start integration test passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
