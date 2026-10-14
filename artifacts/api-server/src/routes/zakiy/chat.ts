import { generateText } from "../../lib/ai-providers.js";
import type { ZakiyMemoryData } from "./types.js";
import { buildZakiySystemPrompt } from "./prompts.js";

export async function generateZakiyResponse(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  memory: ZakiyMemoryData
): Promise<string> {
  const systemPrompt = buildZakiySystemPrompt(memory);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-8),
    { role: "user", content: userMessage },
  ];

  return generateText({
    maxTokens: 900,
    messages,
  });
}
