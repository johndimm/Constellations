/** Read a Vite-style env var from process (e.g. Next.js) or import.meta (Vite). */
export function readBundledEnv(key: string): string {
  const fromProcess = getEnvVar(key);
  if (fromProcess) return fromProcess;
  // Dual-bundler: Vite uses `VITE_*`; Next exposes the same values as `NEXT_PUBLIC_VITE_*`
  // (see apps/soundings/next.config `env`), not `NEXT_PUBLIC_*` with the `VITE_` infix stripped.
  const nextKey = key.startsWith("VITE_") ? `NEXT_PUBLIC_${key}` : key;
  const alt = getEnvVar(nextKey);
  if (alt) return alt;
  try {
    // @ts-ignore
    if (typeof import.meta !== "undefined" && import.meta.env) {
      // @ts-ignore
      const v = import.meta.env[key];
      if (v != null && String(v) !== "") return String(v);
    }
  } catch {
    /* ignore */
  }
  return "";
}

export const getEnvVar = (name: string): string => {
  // Try process.env first (Node.js / Server)
  try {
    if (typeof process !== 'undefined' && process.env) {
      const val = process.env[name];
      if (val) return val;
    }
  } catch (e) { }

  // Try import.meta.env (Vite / Browser)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      const val = import.meta.env[name];
      if (val) return val;
    }
  } catch (e) { }

  return "";
};

let __ccLoggedCacheUrlDiag = false;

export const getEnvCacheUrl = (): string => {
  // Next.js only inlines `process.env.FOO` when `FOO` is a static property access. Dynamic
  // `process.env[name]` stays empty in the browser bundle, which disables the cache proxy and
  // forces slow client-only paths (e.g. `extractMusicEntity`).
  let source: "static-process" | "readBundled" | "none" = "none";
  let out = "";
  try {
    if (typeof process !== "undefined" && process.env) {
      const direct = (
        process.env.VITE_CACHE_URL ||
        process.env.VITE_CACHE_API_URL ||
        process.env.NEXT_PUBLIC_VITE_CACHE_URL ||
        process.env.NEXT_PUBLIC_VITE_CACHE_API_URL ||
        ""
      ).trim();
      if (direct) {
        out = direct;
        source = "static-process";
      }
    }
  } catch {
    /* empty */
  }
  if (!out) {
    const bundled = (
      readBundledEnv("VITE_CACHE_URL") ||
      readBundledEnv("VITE_CACHE_API_URL") ||
      ""
    ).trim();
    if (bundled) {
      out = bundled;
      source = "readBundled";
    }
  }
  if (
    typeof window !== "undefined" &&
    typeof process !== "undefined" &&
    process.env.NODE_ENV === "development" &&
    !__ccLoggedCacheUrlDiag
  ) {
    __ccLoggedCacheUrlDiag = true;
    let host = "";
    try {
      if (out) host = new URL(out).host;
    } catch {
      host = "(invalid URL)";
    }
    console.log("[Constellations]", "getEnvCacheUrl (first read)", { resolved: !!out, source, host });
  }
  return out;
};

/** Default when unset; override with VITE_GEMINI_MODEL or NEXT_PUBLIC_GEMINI_MODEL (Next maps via next.config env). */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const getEnvGeminiModel = (): string => {
  const m = readBundledEnv("VITE_GEMINI_MODEL").trim();
  return m || DEFAULT_GEMINI_MODEL;
};

export const getEnvGeminiModelClassify = (): string => {
  const m = readBundledEnv("VITE_GEMINI_MODEL_CLASSIFY").trim();
  return m || getEnvGeminiModel();
};

// Robust text extraction from Gemini API response
export function getResponseText(response: any): string {
  if (!response) return "";

  // 1. Check if this is the GenerateContentResult wrapper
  const actualResponse = response.response || response;

  // 2. Check for .text() method (Standard SDK)
  if (typeof actualResponse.text === 'function') {
    try {
      const t = actualResponse.text();
      if (t) return t;
    } catch (e) { }
  }

  // 3. Check for .text property
  if (typeof actualResponse.text === 'string') return actualResponse.text;

  // 4. Deep dive into candidates
  try {
    const candidates = actualResponse.candidates || [];
    if (candidates.length > 0) {
      const parts = candidates[0].content?.parts || [];
      const textPart = parts.find((p: any) => p.text);
      if (textPart) return textPart.text;
    }
  } catch (e) { }

  return "";
}

// Clean JSON response from markdown wrappers
export function cleanJson(text: unknown): string {
  if (typeof text !== "string") return "";
  // Remove markdown code blocks if present (e.g. ```json ... ``` or ``` ...)
  return text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
}

/** Extract first top-level `{...}` or `[...]` from a string (string-aware). */
function extractFirstJsonSlice(s: string): string | null {
  const trimmed = s.trim();
  const startObj = trimmed.indexOf("{");
  const startArr = trimmed.indexOf("[");
  let start = -1;
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj;
  else if (startArr >= 0) start = startArr;
  else return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse JSON from Gemini / proxy output: handles markdown fences, then plain text that may
 * include a JSON object embedded in prose (or model noise like "You are a…" before the object).
 */
export function parseJsonFromModelText(text: unknown): unknown | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const cleaned = cleanJson(text);
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const slice = extractFirstJsonSlice(cleaned);
    if (!slice) return null;
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
}

/**
 * Read a fetch Response and parse JSON without throwing. Non-OK responses and HTML or plain
 * error pages (e.g. Wikipedia rate limit text starting with "You are...") return null.
 */
export async function jsonFromResponse<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!res.ok) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// Safely retrieve API key
export async function getApiKey() {
  let key = "";

  // Try process.env first (Node.js)
  try {
    if (typeof process !== 'undefined' && process.env) {
      const env = process.env;
      key = env.VITE_API_KEY ||
        env.NEXT_PUBLIC_API_KEY ||
        env.REACT_APP_API_KEY ||
        env.API_KEY ||
        env.VITE_GEMINI_API_KEY ||
        env.GEMINI_API_KEY ||
        "";
    }
  } catch (e) { }

  if (!key) {
    try {
      // @ts-ignore
      if (typeof import.meta !== 'undefined' && import.meta.env) {
        // Use literal access for Vite static replacement
        // @ts-ignore
        key = import.meta.env.VITE_API_KEY ||
          // @ts-ignore
          import.meta.env.VITE_GEMINI_API_KEY ||
          "";
      }
    } catch (e) { }
  }

  if (!key && typeof window !== 'undefined' && (window as any).aistudio) {
    try {
      key = await (window as any).aistudio.getSelectedApiKey();
    } catch (e) { }
  }

  // Log once whether a key was found (prefix only), to debug missing-key issues without leaking it.
  if (typeof window !== 'undefined') {
    (window as any).__codex_key_logged = (window as any).__codex_key_logged || false;
    if (!(window as any).__codex_key_logged) {
      console.log(`[Key] resolved ${key ? 'present' : 'missing'}${key ? ` (prefix: ${key.slice(0, 6)})` : ''}`);
      (window as any).__codex_key_logged = true;
    }
  }

  return key;
}

/**
 * Strip YouTube channel names, bare years, and other web junk from a pasted search term.
 * Handles multi-line pastes like:
 *   "Alban Berg- Lyric Suite Part 3 Allegro misterioso\nplayingmusiconmars\n1926"
 * Returns the first substantive line with trailing noise removed.
 */
export function sanitizeSearchTerm(raw: string): string {
  if (!raw || typeof raw !== "string") return raw;

  const RECORD_LABELS = /^(warner classics|deutsche grammophon|ecm records|decca|hyperion|harmonia mundi|naïve|sony classical|emi classics|philips classics|virgin classics|erato|chandos|bis records|naxos|ondine|telarc)$/i;

  const isJunkLine = (line: string): boolean => {
    const t = line.trim();
    if (!t) return true;
    // Pure year
    if (/^\d{4}$/.test(t)) return true;
    // YouTube channel pattern: no spaces, lowercase + digits, length > 4
    if (!/\s/.test(t) && /[a-z]/.test(t) && /\d/.test(t) && t.length > 4) return true;
    // Single word, all lowercase, no digits — likely a username without numbers
    if (!/\s/.test(t) && t === t.toLowerCase() && t.length > 10) return true;
    // Known record labels when appearing alone on a line
    if (RECORD_LABELS.test(t)) return true;
    return false;
  };

  // Split on newlines, filter junk lines
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => !isJunkLine(l));
  if (lines.length === 0) return raw.split(/\n/)[0]?.trim() || raw.trim();

  // From the first good line, strip trailing tokens that look like channel names or years
  let first = lines[0].replace(/\s+[a-z][a-z0-9]{4,}\d+\s*$/i, "").trim();  // e.g. "concerts1899"

  // "Performer plays/performs Composer: Work" → "Composer: Work"
  // e.g. "Gautier Capuçon plays Fauré: Sicilienne" → "Fauré: Sicilienne"
  const playsMatch = first.match(/^.+?\s+(?:plays?|performs?|interprets?|conducted?\s+by)\s+(.+)$/i);
  if (playsMatch) {
    const extracted = playsMatch[1].trim();
    if (extracted.length > 3) first = extracted;
  }

  // Strip trailing parenthetical performer info: "Work (Orchestra / Conductor)" → "Work"
  // e.g. "Pavane pour une infante défunte (Orchestre national de France / Dalia Stasevska)"
  first = first.replace(/\s*\([^)]*(?:\/|orchestra|ensemble|philharmonic|conducted)[^)]*\)\s*$/i, "").trim();

  return first || lines[0];
}

// Wrap promise with timeout
export function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMsg));
    }, ms);

    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(reason => {
        clearTimeout(timer);
        reject(reason);
      });
  });
}

export function clipForLlmLog(text: string, maxChars = 16000): string {
  const s = String(text ?? "");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n… [truncated ${s.length - maxChars} more chars]`;
}

export function isRateLimitError(e: any): boolean {
  if (e?.error?.code === 429 || e?.code === 429) return true;
  const s = String(e?.error?.status || "").toLowerCase();
  if (s === "resource_exhausted") return true;
  const t = [e?.message, e?.error, e?.status, e?.code, typeof e === "string" ? e : ""]
    .map(x => (typeof x === "object" ? JSON.stringify(x) : String(x ?? "")))
    .join(" ")
    .toLowerCase();
  return t.includes("429") || t.includes("resource_exhausted");
}

export type LlmProviderId = "gemini" | "deepseek" | "openai" | "anthropic";

const BROWSER_LLM_KEY = "constellations_llm_provider";

function isValidProvider(v: string): v is LlmProviderId {
  return v === "gemini" || v === "deepseek" || v === "openai" || v === "anthropic";
}

export function getBrowserLlmOverride(): LlmProviderId | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(BROWSER_LLM_KEY)?.trim().toLowerCase() ?? "";
    if (isValidProvider(v)) return v;
  } catch {}
  return null;
}

export function setBrowserLlmOverride(provider: LlmProviderId | null): void {
  if (typeof window === "undefined") return;
  try {
    if (provider === null) {
      window.localStorage.removeItem(BROWSER_LLM_KEY);
    } else {
      window.localStorage.setItem(BROWSER_LLM_KEY, provider);
    }
  } catch {}
}

// Server-side per-request override (Node.js module memory, set before each proxy call).
// This is intentionally simple — dev server is single-user so concurrent-request races are fine.
let _serverLlmOverride: LlmProviderId | null = null;

export function setServerLlmOverride(provider: LlmProviderId | null): void {
  _serverLlmOverride = provider;
}

export function getLlmProvider(): LlmProviderId {
  if (_serverLlmOverride) return _serverLlmOverride;
  const browser = getBrowserLlmOverride();
  if (browser) return browser;
  const raw = (readBundledEnv("VITE_AI_PROVIDER") || "gemini").trim().toLowerCase();
  return isValidProvider(raw) ? raw : "deepseek";
}

/**
 * Returns true if `term` is likely a person name (2–4 Title-Case words, no parens or digits,
 * no leading article). Used as a sanity-check on LLM classification results and fallbacks.
 * False-positives (e.g. "Star Wars") can happen, but this is only consulted when the model
 * returns or falls back to isAtomic=false, so the worst case is a wrong default that the user
 * can easily correct by re-searching with a disambiguated term.
 */
export function looksLikePersonName(term: string): boolean {
  const t = term.trim();
  if (/[()[\]{}]/.test(t)) return false;  // parenthetical tags → work title
  if (/\d/.test(t)) return false;          // digits → year / track number
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // Leading stopwords rule out "The Godfather", "A Star Is Born", etc.
  if (/^(the|a|an|of|in|on|at|to|for|with|by|la|le|les|el|los|das|der|die)$/i.test(words[0])) return false;
  // Each word: Title-Case word (≥2 chars), single initial with period, or name suffix
  const nameWordRe = /^[A-Z][a-z'-]{1,}\.?$|^[A-Z]\.$|^(Jr|Sr|II|III|IV|VI|VII|VIII|IX)\.?$/;
  return words.every(w => nameWordRe.test(w));
}

// Improved retry logic with exponential backoff and jitter
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, backoffMs = 1000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = String(error?.message || error || '').toLowerCase();
      // Only retry if it looks like a transient error (rate limit, timeout, or network)
      const isRetryable =
        errorStr.includes('429') ||
        errorStr.includes('resource_exhausted') ||
        errorStr.includes('rate limit') ||
        errorStr.includes('timeout') ||
        errorStr.includes('fetch') ||
        errorStr.includes('network');

      if (i < attempts - 1 && isRetryable) {
        // Exponential backoff: 1s, 2s, 4s...
        const baseDelay = backoffMs * Math.pow(2, i);
        // Add jitter: +/- 20% to avoid "thundering herd"
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.max(0, baseDelay + jitter);

        console.warn(`[Retry] Attempt ${i + 1} failed. Retrying in ${Math.round(delay)}ms...`, errorStr);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
