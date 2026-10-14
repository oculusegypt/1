import { generateText } from "../../lib/ai-providers.js";
import { db } from "@workspace/db";
import { zakiyMemoryTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { ZakiyMemoryData, ZakiyPromise } from "./types.js";

export async function loadMemory(sessionId: string): Promise<ZakiyMemoryData> {
  const defaultMemory: ZakiyMemoryData = { traits: [], challenges: [], recentTopics: [], personalNote: "", promises: [], slips: [] };
  if (!sessionId) return defaultMemory;
  try {
    const row = await db.query.zakiyMemoryTable.findFirst({ where: eq(zakiyMemoryTable.sessionId, sessionId) });
    if (!row) return defaultMemory;
    const parsed = JSON.parse(row.memoryJson) as Partial<ZakiyMemoryData>;
    return { ...defaultMemory, ...parsed };
  } catch { return defaultMemory; }
}

export async function updateMemory(
  sessionId: string,
  userMessage: string,
  botResponse: string,
  currentMemory: ZakiyMemoryData
): Promise<void> {
  if (!sessionId) return;
  try {
    const extraction = await generateText({
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content: `أنت محلل نفسي ذكي. مهمتك استخراج معلومات شخصية مفيدة عن المستخدم من المحادثة وتحديث الذاكرة.
أرجع JSON فقط بالهيكل ده (لا تغير المفاتيح):
{
  "traits": ["صفة 1", "صفة 2"],
  "challenges": ["تحدي 1"],
  "recentTopics": ["موضوع المحادثة الحالية"],
  "personalNote": "ملاحظة مختصرة جداً عن شخصيته",
  "promises": [],
  "slips": []
}

الذاكرة الحالية (احتفظ بها وادمج فيها فقط):
${JSON.stringify(currentMemory, null, 2)}

تعليمات خاصة للوعود والزللات:
- لو المستخدم اعترف بذنب أو معصية: أضف إلى slips بالشكل: {"sin": "اسم الذنب", "date": "${new Date().toISOString().slice(0,10)}", "afterPromise": true/false}
  - afterPromise: true لو عنده وعد مكسور يتعلق بهذا الذنب
- لو الرد فيه مارك وعد {{promise:...}}: لا تضيفه للذاكرة هنا — هيتضاف لما يضغط الزر
- promises و slips: احتفظ بكل القديم، فقط أضف الجديد
- traits و challenges: أقصى 5 عناصر — احتفظ بالأهم

لو ما فيش معلومات جديدة، أعد الذاكرة كما هي.`,
        },
        {
          role: "user",
          content: `المستخدم قال: "${userMessage}"\nالزكي رد: "${botResponse.slice(0, 300)}"`,
        },
      ],
    });

    const raw = extraction;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const newMemory = JSON.parse(jsonMatch[0]) as ZakiyMemoryData;

    await db
      .insert(zakiyMemoryTable)
      .values({ sessionId, memoryJson: JSON.stringify(newMemory), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: zakiyMemoryTable.sessionId,
        set: { memoryJson: JSON.stringify(newMemory), updatedAt: new Date() },
      });
  } catch { /* fire-and-forget — don't fail the main response */ }
}

export async function savePromiseToMemory(sessionId: string, promiseText: string): Promise<void> {
  if (!sessionId) return;
  const memory = await loadMemory(sessionId);
  const newPromise: ZakiyPromise = {
    text: promiseText,
    date: new Date().toISOString().slice(0, 10),
    broken: false,
    brokenCount: 0,
  };
  const existing = memory.promises.find((p) => p.text === promiseText);
  if (existing) {
    existing.broken = false;
    existing.date = newPromise.date;
  } else {
    memory.promises.push(newPromise);
  }
  await db
    .insert(zakiyMemoryTable)
    .values({ sessionId, memoryJson: JSON.stringify(memory), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: zakiyMemoryTable.sessionId,
      set: { memoryJson: JSON.stringify(memory), updatedAt: new Date() },
    });
}

export async function markPromiseBroken(sessionId: string, _sin: string): Promise<void> {
  if (!sessionId) return;
  try {
    const memory = await loadMemory(sessionId);
    let changed = false;
    for (const p of memory.promises) {
      if (!p.broken) {
        p.broken = true;
        p.brokenCount = (p.brokenCount ?? 0) + 1;
        changed = true;
      }
    }
    if (changed) {
      await db
        .insert(zakiyMemoryTable)
        .values({ sessionId, memoryJson: JSON.stringify(memory), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: zakiyMemoryTable.sessionId,
          set: { memoryJson: JSON.stringify(memory), updatedAt: new Date() },
        });
    }
  } catch { /* ignore */ }
}

export function buildMemorySection(memory: ZakiyMemoryData): string {
  const parts: string[] = [];
  if (memory.traits.length) parts.push(`🧠 صفاته: ${memory.traits.join("، ")}`);
  if (memory.challenges.length) parts.push(`⚡ تحدياته: ${memory.challenges.join("، ")}`);
  if (memory.recentTopics.length) parts.push(`📌 آخر مواضيعه: ${memory.recentTopics.join("، ")}`);
  if (memory.personalNote) parts.push(`📝 ملاحظة: ${memory.personalNote}`);

  const activePromises = memory.promises?.filter((p) => !p.broken) ?? [];
  const brokenPromises = memory.promises?.filter((p) => p.broken) ?? [];
  const recentSlips = memory.slips?.slice(-5) ?? [];

  if (activePromises.length) {
    parts.push(`🤝 وعوده القائمة:\n${activePromises.map((p) => `  - "${p.text}" (${p.date})`).join("\n")}`);
  }
  if (brokenPromises.length) {
    parts.push(`💔 وعود كسرها:\n${brokenPromises.map((p) => `  - "${p.text}" (كُسر ${p.brokenCount} مرة)`).join("\n")}`);
  }
  if (recentSlips.length) {
    parts.push(`⚠️ زللاته الأخيرة:\n${recentSlips.map((s) => `  - ${s.sin} (${s.date})${s.afterPromise ? " [بعد وعد!]" : ""}`).join("\n")}`);
  }

  if (!parts.length) return "";
  return `\n╔══════════════════════════════╗\n║       ما تعرفه عن صاحبك       ║\n╚══════════════════════════════╝\n${parts.join("\n")}\n`;
}
