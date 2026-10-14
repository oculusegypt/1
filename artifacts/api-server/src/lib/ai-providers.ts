export type AIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ProviderId = "qwen" | "glm" | "gemini";

type ProviderConfig = {
  id: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
};

type CompletionOptions = {
  messages: AIChatMessage[];
  maxTokens: number;
  timeoutMs?: number;
};

type CompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
};

class ProviderAttemptFailure extends Error {
  constructor(
    readonly reason: "http_error" | "invalid_response" | "empty_response",
    readonly statusCode?: number,
  ) {
    super(reason);
    this.name = "ProviderAttemptFailure";
  }
}

export class AIProvidersUnavailableError extends Error {
  constructor() {
    super("AI_UNAVAILABLE");
    this.name = "AIProvidersUnavailableError";
  }
}

function getProviders(): ProviderConfig[] {
  const providers: Array<ProviderConfig | null> = [
    process.env.DASHSCOPE_API_KEY &&
    process.env.DASHSCOPE_FREE_QUOTA_ONLY_CONFIRMED === "true"
      ? {
          id: "qwen",
          apiKey: process.env.DASHSCOPE_API_KEY,
          baseUrl:
            process.env.DASHSCOPE_BASE_URL ??
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
          model: process.env.DASHSCOPE_MODEL ?? "qwen3.8-max",
        }
      : null,
    process.env.GLM_API_KEY
      ? {
          id: "glm",
          apiKey: process.env.GLM_API_KEY,
          baseUrl:
            process.env.GLM_API_BASE_URL ?? "https://api.z.ai/api/paas/v4",
          model: process.env.GLM_MODEL ?? "glm-4.7-flash",
        }
      : null,
    process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_PAID_TIER_CONFIRMED === "true"
      ? {
          id: "gemini",
          apiKey: process.env.GEMINI_API_KEY,
          baseUrl:
            process.env.GEMINI_API_BASE_URL ??
            "https://generativelanguage.googleapis.com/v1beta/openai",
          model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
        }
      : null,
  ];

  return providers.filter((provider): provider is ProviderConfig => provider !== null);
}

export function hasTextAIProviderConfigured(): boolean {
  return getProviders().length > 0;
}

function extractText(payload: CompletionPayload): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }
  return "";
}

async function requestProvider(
  provider: ProviderConfig,
  messages: AIChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new ProviderAttemptFailure("http_error", response.status);
    }

    let payload: CompletionPayload;
    try {
      payload = (await response.json()) as CompletionPayload;
    } catch {
      throw new ProviderAttemptFailure("invalid_response", response.status);
    }

    const text = extractText(payload);
    if (!text) {
      throw new ProviderAttemptFailure("empty_response", response.status);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function getFailureDetails(error: unknown): {
  reason: string;
  statusCode: number | null;
} {
  if (error instanceof ProviderAttemptFailure) {
    return { reason: error.reason, statusCode: error.statusCode ?? null };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { reason: "timeout", statusCode: null };
  }
  return { reason: "network_error", statusCode: null };
}

/**
 * Sends text requests only to configured providers. Request/response bodies,
 * prompts, user content, API keys, and raw provider errors are never logged.
 */
export async function generateText({
  messages,
  maxTokens,
  timeoutMs = 75_000,
}: CompletionOptions): Promise<string> {
  const providers = getProviders();
  if (providers.length === 0) throw new AIProvidersUnavailableError();

  const deadline = Date.now() + timeoutMs;
  for (const provider of providers) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    try {
      return await requestProvider(
        provider,
        messages,
        maxTokens,
        Math.min(35_000, remainingMs),
      );
    } catch (error) {
      const details = getFailureDetails(error);
      console.warn("[AI] provider attempt failed", {
        provider: provider.id,
        reason: details.reason,
        statusCode: details.statusCode,
      });
    }
  }

  throw new AIProvidersUnavailableError();
}
