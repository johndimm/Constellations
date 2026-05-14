/**
 * Provider dispatcher. Set VITE_AI_PROVIDER=deepseek (or gemini) in .env.local.
 * Defaults to gemini when unset.
 */
import { readBundledEnv } from "./aiUtils";
import * as gemini from "./geminiService";
import * as deepseek from "./deepseekService";

export * from "./aiUtils";
export type { LockedPair } from "./geminiService";

const isDeepSeek = (readBundledEnv("VITE_AI_PROVIDER") || "gemini").toLowerCase() === "deepseek";
const svc = isDeepSeek ? deepseek : gemini;

export const classifyStartPair         = (...args: Parameters<typeof svc.classifyStartPair>)         => svc.classifyStartPair(...args);
export const classifyEntity            = (...args: Parameters<typeof svc.classifyEntity>)            => svc.classifyEntity(...args);
export const fetchConnections          = (...args: Parameters<typeof svc.fetchConnections>)          => svc.fetchConnections(...args);
export const fetchPersonWorks          = (...args: Parameters<typeof svc.fetchPersonWorks>)          => svc.fetchPersonWorks(...args);
export const fetchConnectionPath       = (...args: Parameters<typeof svc.fetchConnectionPath>)       => svc.fetchConnectionPath(...args);
export const findWikipediaTitle        = (...args: Parameters<typeof svc.findWikipediaTitle>)        => svc.findWikipediaTitle(...args);
// Always uses Gemini — relies on Google Search grounding which is Gemini-specific.
export const fetchOrgKeyPeopleBlockViaSearch = gemini.fetchOrgKeyPeopleBlockViaSearch;
export const defaultStartPairResult    = (...args: Parameters<typeof svc.defaultStartPairResult>)    => svc.defaultStartPairResult(...args);
