import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AIProvidersUnavailableError,
  generateText,
} from "./ai-providers.js";

const providerEnvKeys = [
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_FREE_QUOTA_ONLY_CONFIRMED",
  "DASHSCOPE_BASE_URL",
  "DASHSCOPE_MODEL",
  "GLM_API_KEY",
  "GLM_API_BASE_URL",
  "GLM_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_API_BASE_URL",
  "GEMINI_API_PAID_TIER_CONFIRMED",
  "GEMINI_MODEL",
] as const;

const originalEnv = new Map<string, string | undefined>();
let originalFetch: typeof globalThis.fetch;
let originalWarn: typeof console.warn;
let warnings: unknown[][];

const testMessages = [
  { role: "user" as const, content: "private-prompt-marker" },
];

function mockCompletion(text: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("AI provider selection and fallback", () => {
  beforeEach(() => {
    originalEnv.clear();
    for (const key of providerEnvKeys) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    originalFetch = globalThis.fetch;
    originalWarn = console.warn;
    warnings = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  it("does not enable Qwen without explicit free-quota confirmation", async () => {
    process.env.DASHSCOPE_API_KEY = "qwen-test-secret";
    process.env.GEMINI_API_KEY = "gemini-test-secret";

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return mockCompletion("unexpected");
    };

    await assert.rejects(
      generateText({ messages: testMessages, maxTokens: 32 }),
      AIProvidersUnavailableError,
    );
    assert.equal(fetchCalls, 0);
  });

  it("tries Qwen before GLM and does not use unconfirmed Gemini as fallback", async () => {
    process.env.DASHSCOPE_API_KEY = "qwen-test-secret";
    process.env.DASHSCOPE_FREE_QUOTA_ONLY_CONFIRMED = "true";
    process.env.DASHSCOPE_BASE_URL = "https://qwen.test/v1";
    process.env.GLM_API_KEY = "glm-test-secret";
    process.env.GLM_API_BASE_URL = "https://glm.test/v1";
    process.env.GEMINI_API_KEY = "gemini-test-secret";

    const requests: Array<{
      url: string;
      body: Record<string, unknown>;
    }> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });

      if (url.startsWith("https://qwen.test/")) {
        return new Response("provider unavailable", { status: 503 });
      }
      return mockCompletion("glm-response");
    };

    const result = await generateText({
      messages: testMessages,
      maxTokens: 32,
    });

    assert.equal(result, "glm-response");
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        "https://qwen.test/v1/chat/completions",
        "https://glm.test/v1/chat/completions",
      ],
    );
    assert.equal(requests[0]?.body.reasoning_effort, "none");
    assert.equal(requests[1]?.body.reasoning_effort, undefined);

    const logged = JSON.stringify(warnings);
    assert.equal(logged.includes("qwen-test-secret"), false);
    assert.equal(logged.includes("glm-test-secret"), false);
    assert.equal(logged.includes("private-prompt-marker"), false);
  });

  it("uses Gemini only after paid-tier confirmation", async () => {
    process.env.GEMINI_API_KEY = "gemini-test-secret";
    process.env.GEMINI_API_BASE_URL = "https://gemini.test/v1";
    process.env.GEMINI_MODEL = "gemini-test-model";

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return mockCompletion("gemini-response");
    };

    await assert.rejects(
      generateText({ messages: testMessages, maxTokens: 32 }),
      AIProvidersUnavailableError,
    );
    assert.equal(fetchCalls, 0);

    process.env.GEMINI_API_PAID_TIER_CONFIRMED = "true";
    const result = await generateText({
      messages: testMessages,
      maxTokens: 32,
    });

    assert.equal(result, "gemini-response");
    assert.equal(fetchCalls, 1);
  });
});
