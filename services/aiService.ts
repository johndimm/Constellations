/**
 * Provider dispatcher. gemini → geminiService; everything else →
 * deepseekService (which re-reads getLlmProvider() inside callAltLlm
 * to pick the right API: deepseek / openai / anthropic).
 */
import { getLlmProvider } from "./aiUtils";
import * as geminiSvc from "./geminiService";
import * as altSvc from "./deepseekService"; // handles deepseek, openai, anthropic

export * from "./aiUtils";
export type { LockedPair } from "./geminiService";

function getSvc(fn: string) {
  const p = getLlmProvider();
  console.info(`[LLM] ${p} · ${fn}`);
  return p === "gemini" ? geminiSvc : altSvc;
}

export const classifyStartPair         = (...args: Parameters<typeof geminiSvc.classifyStartPair>)         => getSvc("classifyStartPair").classifyStartPair(...args);
export const classifyEntity            = (...args: Parameters<typeof geminiSvc.classifyEntity>)            => getSvc("classifyEntity").classifyEntity(...args);
export const fetchConnections          = (...args: Parameters<typeof geminiSvc.fetchConnections>)          => getSvc("fetchConnections").fetchConnections(...args);
export const fetchPersonWorks          = (...args: Parameters<typeof geminiSvc.fetchPersonWorks>)          => getSvc("fetchPersonWorks").fetchPersonWorks(...args);
export const fetchConnectionPath       = (...args: Parameters<typeof geminiSvc.fetchConnectionPath>)       => getSvc("fetchConnectionPath").fetchConnectionPath(...args);
export const findWikipediaTitle        = (...args: Parameters<typeof geminiSvc.findWikipediaTitle>)        => getSvc("findWikipediaTitle").findWikipediaTitle(...args);
// Always uses Gemini — relies on Google Search grounding which is Gemini-specific.
export const fetchOrgKeyPeopleBlockViaSearch = geminiSvc.fetchOrgKeyPeopleBlockViaSearch;
export const defaultStartPairResult    = (...args: Parameters<typeof geminiSvc.defaultStartPairResult>)    => getSvc("defaultStartPairResult").defaultStartPairResult(...args);
