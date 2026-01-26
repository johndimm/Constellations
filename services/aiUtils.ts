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

  return getEnvVar("VITE_GEMINI_MODEL") || "gemini-2.0-flash";
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

// Retry logic
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, backoffMs = 300): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        const delay = backoffMs * (i + 1);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw lastError;
}
