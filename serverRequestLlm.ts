import { AsyncLocalStorage } from "node:async_hooks";

export type RequestLlmId = "gemini" | "openai" | "deepseek" | "anthropic";

const als = new AsyncLocalStorage<RequestLlmId>();

function normalize(raw: unknown): RequestLlmId | null {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === "gemini" || v === "openai" || v === "deepseek" || v === "anthropic") return v;
  return null;
}

/** Run async work with getLlmProvider() reflecting this request's llmProvider (from proxy JSON body). */
export function withRequestLlm<T>(llmProvider: unknown, fn: () => Promise<T>): Promise<T> {
  const p = normalize(llmProvider);
  if (!p) return fn();
  return als.run(p, fn);
}

/** For aiUtils.registerServerRequestLlmReader — null when not inside a proxied request. */
export function readRequestLlm(): RequestLlmId | null {
  return als.getStore() ?? null;
}
