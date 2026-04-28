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

export const getEnvCacheUrl = (): string => {
  // Use literal access for Vite static replacement
  let url = "";
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      url = import.meta.env.VITE_CACHE_URL || import.meta.env.VITE_CACHE_API_URL || "";
    }
  } catch (e) { }

  if (url) return url;

  return getEnvVar("VITE_CACHE_URL") || getEnvVar("VITE_CACHE_API_URL");
};

export const getEnvGeminiModel = (): string => {
  // Literal access for Vite
  let urlModel = "";
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      urlModel = import.meta.env.VITE_GEMINI_MODEL || "";
    }
  } catch (e) { }
  if (urlModel) return urlModel;

  return getEnvVar("VITE_GEMINI_MODEL") || "gemini-2.5-flash";
};

export const getEnvGeminiModelClassify = (): string => {
  // Literal access for Vite
  let urlModel = "";
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      urlModel = import.meta.env.VITE_GEMINI_MODEL_CLASSIFY || "";
    }
  } catch (e) { }
  if (urlModel) return urlModel;

  return getEnvVar("VITE_GEMINI_MODEL_CLASSIFY") || getEnvGeminiModel();
};

export type LlmProviderId = "gemini" | "openai" | "deepseek" | "anthropic";

/** Node cache server only: per-request override from JSON body `llmProvider`. */
let readServerRequestLlm: () => LlmProviderId | null = () => null;

/** Register reader from server.ts (uses AsyncLocalStorage). No-op in the browser bundle. */
export function registerServerRequestLlmReader(reader: () => LlmProviderId | null): void {
  readServerRequestLlm = reader;
}

const BROWSER_LLM_KEY = "constellations_llm_provider";

/** In-browser override (ControlPanel); ignored on the Node cache server. */
export function getBrowserLlmOverride(): LlmProviderId | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(BROWSER_LLM_KEY)?.trim().toLowerCase();
    if (v === "openai" || v === "deepseek" || v === "anthropic" || v === "gemini") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Persist or clear browser LLM choice. Pass null to follow .env / VITE_LLM_PROVIDER again. */
export function setBrowserLlmOverride(provider: LlmProviderId | null): void {
  if (typeof window === "undefined") return;
  try {
    if (provider === null) {
      window.localStorage.removeItem(BROWSER_LLM_KEY);
    } else {
      window.localStorage.setItem(BROWSER_LLM_KEY, provider);
    }
  } catch {
    /* ignore */
  }
}

/** Set LLM_PROVIDER (preferred on servers) or VITE_LLM_PROVIDER to openai | deepseek | anthropic | gemini (default). In the browser, a ControlPanel choice overrides via localStorage. On the cache server, an optional JSON field llmProvider overrides for that request only. */
export function getLlmProvider(): LlmProviderId {
  const req = readServerRequestLlm();
  if (req) return req;

  const browser = getBrowserLlmOverride();
  if (browser) return browser;

  // LLM_PROVIDER first: Render/Heroku/etc. set this; VITE_* must not override it if both exist.
  const raw = (getEnvVar("LLM_PROVIDER") || getEnvVar("VITE_LLM_PROVIDER") || "gemini")
    .trim()
    .toLowerCase();
  if (raw === "openai" || raw === "deepseek" || raw === "anthropic" || raw === "gemini") {
    return raw;
  }
  return "gemini";
}

/** API key for the active provider (Gemini uses existing getApiKey / AI Studio). */
export async function getLlmApiKey(): Promise<string> {
  const p = getLlmProvider();
  if (p === "gemini") {
    return getApiKey();
  }
  // Prefer plain env names on servers (OPENAI_API_KEY); VITE_* is for local Vite client.
  const keys: Record<Exclude<LlmProviderId, "gemini">, [string, string]> = {
    openai: ["OPENAI_API_KEY", "VITE_OPENAI_API_KEY"],
    deepseek: ["DEEPSEEK_API_KEY", "VITE_DEEPSEEK_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY", "VITE_ANTHROPIC_API_KEY"],
  };
  const [primary, secondary] = keys[p];
  return getEnvVar(primary) || getEnvVar(secondary);
}

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
 * `fetch` with a hard timeout so a hung cache/LLM endpoint cannot leave expansions spinning forever.
 * Do not pass `signal` in init unless you compose with this controller (not supported here).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 45000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/** Truncate for console; LLM prompts/contexts can be huge. */
export function clipForLlmLog(text: string, maxChars = 16000): string {
  const s = String(text ?? "");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n… [truncated ${s.length - maxChars} more chars]`;
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

/** Collects message / nested API fields / JSON so 429s are not missed as "[object Object]". */
function errorTextForMatch(e: any): string {
  const parts: string[] = [];
  if (e?.message) parts.push(String(e.message));
  if (e?.error) {
    parts.push(
      typeof e.error === "string" ? e.error : JSON.stringify(e.error)
    );
  }
  if (e?.status) parts.push(String(e.status));
  if (e?.code !== undefined && e?.code !== null) parts.push(String(e.code));
  if (typeof e === "string") parts.push(e);
  if (typeof e === "object" && parts.length === 0) {
    try {
      parts.push(JSON.stringify(e));
    } catch {
      parts.push(String(e));
    }
  }
  return parts.join(" ").toLowerCase();
}

/** True for HTTP 429 / RESOURCE_EXHAUSTED (e.g. Vertex quota). */
export function isRateLimitError(e: any): boolean {
  if (e?.error?.code === 429) return true;
  if (e?.code === 429) return true;
  const s = String(e?.error?.status || "").toLowerCase();
  if (s === "resource_exhausted") return true;
  const t = errorTextForMatch(e);
  return t.includes("429") || t.includes("resource_exhausted");
}

function isTransientError(errText: string): boolean {
  return (
    errText.includes("429") ||
    errText.includes("resource_exhausted") ||
    errText.includes("rate limit") ||
    errText.includes("timeout") ||
    errText.includes("fetch") ||
    errText.includes("network") ||
    errText.includes("econnreset") ||
    errText.includes("etimedout") ||
    errText.includes("503") ||
    errText.includes("unavailable")
  );
}

/**
 * Retries on transient API failures. If a 429 (rate / quota) is seen, the run can extend
 * to `rateLimitAttempts` tries with longer waits (Vertex often needs many seconds between retries).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  backoffMs = 1000,
  rateLimitAttempts = 8
): Promise<T> {
  let lastError: any;
  let maxTries = Math.max(1, attempts);
  for (let i = 0; i < maxTries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (isRateLimitError(error)) {
        maxTries = Math.max(maxTries, rateLimitAttempts);
      }
      const errText = errorTextForMatch(error);
      const retryable = isTransientError(errText);
      const isLast = i + 1 >= maxTries;
      if (isLast || !retryable) {
        throw error;
      }
      const isRate = isRateLimitError(error);
      // Longer waits for 429/RESOURCE_EXHAUSTED (capped) vs generic transient errors
      const baseDelay = isRate
        ? Math.min(90_000, 5_000 * Math.pow(1.45, i))
        : backoffMs * Math.pow(2, i);
      const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
      const delay = Math.max(0, baseDelay + jitter);

      console.warn(
        `[Retry] Attempt ${i + 1} failed. Retrying in ${Math.round(delay)}ms...`,
        errText.slice(0, 500)
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastError;
}
