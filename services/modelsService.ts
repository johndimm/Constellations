export interface ModelInfo {
  provider: string;
  id: string;
  displayName: string;
}

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const cache = new Map<string, CacheEntry>();

function cached(provider: string): ModelInfo[] | null {
  const entry = cache.get(provider);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) return entry.models;
  return null;
}

function store(provider: string, models: ModelInfo[]): ModelInfo[] {
  cache.set(provider, { models, fetchedAt: Date.now() });
  return models;
}

async function fetchGeminiModels(): Promise<ModelInfo[]> {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
  if (!key) return [];
  const hit = cached("gemini");
  if (hit) return hit;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
    if (!res.ok) return [];
    const data = await res.json() as { models?: any[] };
    const models = (data.models ?? [])
      .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .filter((m: any) => !/embedding|aqa|vision-001/i.test(m.name ?? ""))
      .map((m: any) => ({
        provider: "gemini",
        id: String(m.name ?? "").replace(/^models\//, ""),
        displayName: m.displayName || String(m.name ?? "").replace(/^models\//, ""),
      }))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    return store("gemini", models);
  } catch {
    return [];
  }
}

async function fetchAnthropicModels(): Promise<ModelInfo[]> {
  const key = process.env.VITE_ANTHROPIC_API_KEY || "";
  if (!key) return [];
  const hit = cached("anthropic");
  if (hit) return hit;
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: any[] };
    const models = (data.data ?? [])
      .filter((m: any) => String(m.id ?? "").startsWith("claude-"))
      .map((m: any) => ({
        provider: "anthropic",
        id: String(m.id ?? ""),
        displayName: m.display_name || m.id,
      }))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    return store("anthropic", models);
  } catch {
    return [];
  }
}

async function fetchOpenAICompatibleModels(
  provider: "openai" | "deepseek",
  baseUrl: string,
  key: string,
  filter: (id: string) => boolean
): Promise<ModelInfo[]> {
  if (!key) return [];
  const hit = cached(provider);
  if (hit) return hit;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: any[] };
    const models = (data.data ?? [])
      .filter((m: any) => filter(String(m.id ?? "")))
      .map((m: any) => ({
        provider,
        id: String(m.id ?? ""),
        displayName: m.id,
      }))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    return store(provider, models);
  } catch {
    return [];
  }
}

function isOpenAIChatModel(id: string): boolean {
  if (!/^(gpt-|o\d|chatgpt-)/i.test(id)) return false;
  if (/instruct|whisper|dall-e|tts|embed|search|realtime|audio|preview.*audio/i.test(id)) return false;
  return true;
}

async function fetchDeepSeekModels(): Promise<ModelInfo[]> {
  const key = process.env.VITE_DEEPSEEK_API_KEY || "";
  const baseUrl = process.env.VITE_DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  return fetchOpenAICompatibleModels("deepseek", baseUrl, key, () => true);
}

async function fetchOpenAIModels(): Promise<ModelInfo[]> {
  const key = process.env.VITE_OPENAI_API_KEY || "";
  const baseUrl = process.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1";
  return fetchOpenAICompatibleModels("openai", baseUrl, key, isOpenAIChatModel);
}

export async function fetchAllModels(): Promise<ModelInfo[]> {
  const results = await Promise.allSettled([
    fetchGeminiModels(),
    fetchAnthropicModels(),
    fetchDeepSeekModels(),
    fetchOpenAIModels(),
  ]);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

export async function fetchModelsForProvider(provider: string): Promise<ModelInfo[]> {
  switch (provider) {
    case "gemini":    return fetchGeminiModels();
    case "anthropic": return fetchAnthropicModels();
    case "deepseek":  return fetchDeepSeekModels();
    case "openai":    return fetchOpenAIModels();
    default:          return [];
  }
}
