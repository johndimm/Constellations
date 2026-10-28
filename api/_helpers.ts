import type { VercelRequest, VercelResponse } from "@vercel/node";
import { setServerLlmOverride } from "../services/aiService";
import type { LlmProviderId } from "../services/aiUtils";
import { setServerLlmModelOverride } from "../services/aiUtils";

export type { VercelRequest, VercelResponse };

export function cors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

function serverHasCredentials(provider: string): boolean {
  switch (provider) {
    case "gemini":
      return !!(process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || process.env.VITE_GEMINI_API_KEY);
    case "deepseek":
      return !!process.env.VITE_DEEPSEEK_API_KEY;
    case "openai":
      return !!(process.env.VITE_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
    case "anthropic":
      return !!process.env.VITE_ANTHROPIC_API_KEY;
    default:
      return false;
  }
}

function firstAvailableProvider(): LlmProviderId {
  for (const p of ["deepseek", "gemini", "openai"] as LlmProviderId[]) {
    if (serverHasCredentials(p)) return p;
  }
  return "gemini";
}

export function applyProviderFromRequest(body: any): void {
  const requested = body?.llmProvider;
  if (requested && typeof requested === "string" && serverHasCredentials(requested)) {
    setServerLlmOverride(requested as LlmProviderId);
  } else if (requested && !serverHasCredentials(requested)) {
    setServerLlmOverride(firstAvailableProvider());
  } else {
    setServerLlmOverride(null);
  }
  const model = body?.llmModel;
  setServerLlmModelOverride(model && typeof model === "string" ? model : null);
}
