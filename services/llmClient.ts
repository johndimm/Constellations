import {
  clipForLlmLog,
  getEnvVar,
  getLlmProvider,
  getLlmApiKey,
  getResponseText,
  isRateLimitError,
  withRetry,
  withTimeout,
  type LlmProviderId,
} from "./aiUtils";

type RunJsonOptions = {
  system?: string;
  user: string;
  timeoutMs: number;
  /** Required only when getLlmProvider() is gemini */
  gemini?: () => Promise<any>;
  attempts?: number;
};

type OpenAiCompatOpts = { apiKey?: string };

async function openAiCompatibleJson(
  provider: "openai" | "deepseek",
  system: string | undefined,
  user: string,
  opts?: OpenAiCompatOpts
): Promise<string> {
  const key = opts?.apiKey || (await getLlmApiKey());
  if (!key) throw new Error(`No API key for ${provider}`);

  const baseUrl =
    provider === "deepseek"
      ? (getEnvVar("VITE_DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1").replace(/\/$/, "")
      : (getEnvVar("VITE_OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");

  const model =
    provider === "deepseek"
      ? getEnvVar("VITE_DEEPSEEK_MODEL") || "deepseek-chat"
      : getEnvVar("VITE_OPENAI_MODEL") || "gpt-4o-mini";

  const messages: { role: string; content: string }[] = [];
  if (system?.trim()) {
    messages.push({ role: "system", content: system });
  }
  messages.push({
    role: "user",
    content: `${user}\n\nRespond with a single JSON object only (no markdown fences).`,
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || JSON.stringify(data));
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenAI-compatible API returned empty content");
  }
  return text;
}

async function anthropicJson(system: string | undefined, user: string): Promise<string> {
  const key = await getLlmApiKey();
  if (!key) throw new Error("No API key for anthropic");

  const model = getEnvVar("VITE_ANTHROPIC_MODEL") || "claude-3-5-haiku-20241022";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      ...(system?.trim() ? { system: system.trim() } : {}),
      messages: [
        {
          role: "user",
          content: `${user}\n\nReply with a single valid JSON object only. No markdown, no commentary.`,
        },
      ],
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data));
  }
  const block = data?.content?.[0];
  const text = block?.type === "text" ? block.text : "";
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Anthropic API returned empty content");
  }
  return text;
}

async function runAltProvider(p: Exclude<LlmProviderId, "gemini">, system: string | undefined, user: string) {
  if (p === "anthropic") {
    return anthropicJson(system, user);
  }
  return openAiCompatibleJson(p, system, user, undefined);
}

/**
 * Run a JSON completion: Gemini via @google/genai callback, or OpenAI / DeepSeek / Anthropic via HTTPS.
 */
export async function runJsonCompletion(options: RunJsonOptions): Promise<string> {
  const p = getLlmProvider();
  const attempts = options.attempts ?? 4;

  console.info("[LLM] runJsonCompletion REQUEST", {
    provider: p,
    system: clipForLlmLog(options.system ?? ""),
    user: clipForLlmLog(options.user),
  });

  let text: string;

  if (p === "gemini") {
    if (!options.gemini) {
      throw new Error("runJsonCompletion: gemini callback is required when LLM_PROVIDER is gemini");
    }
    try {
      const out = await withRetry(
        () => withTimeout(options.gemini!(), options.timeoutMs, "LLM request timed out"),
        attempts,
        1000
      );
      text = getResponseText(out);
    } catch (e: any) {
      if (isRateLimitError(e)) {
        const openaiKey = getEnvVar("OPENAI_API_KEY") || getEnvVar("VITE_OPENAI_API_KEY");
        if (openaiKey) {
          console.warn(
            "[LLM] Gemini rate/quota exhausted; retrying this request with OpenAI (OPENAI_API_KEY)."
          );
          text = await withTimeout(
            openAiCompatibleJson("openai", options.system, options.user, { apiKey: openaiKey }),
            options.timeoutMs,
            "OpenAI fallback timed out"
          );
        } else if (getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("VITE_DEEPSEEK_API_KEY")) {
          const deepseekKey = getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("VITE_DEEPSEEK_API_KEY")!;
          console.warn(
            "[LLM] Gemini rate/quota exhausted; retrying this request with DeepSeek (DEEPSEEK_API_KEY)."
          );
          text = await withTimeout(
            openAiCompatibleJson("deepseek", options.system, options.user, { apiKey: deepseekKey }),
            options.timeoutMs,
            "DeepSeek fallback timed out"
          );
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }
  } else {
    text = await withRetry(
      () =>
        withTimeout(
          runAltProvider(p, options.system, options.user),
          options.timeoutMs,
          "LLM request timed out"
        ),
      attempts,
      1000
    );
  }

  console.info("[LLM] runJsonCompletion RESPONSE", {
    chars: text.length,
    text: clipForLlmLog(text),
  });
  return text;
}
