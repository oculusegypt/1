import { Router, type IRouter } from "express";
import { speechToText, ensureCompatibleFormat } from "@workspace/integrations-openai-ai-server/audio";
import { generateText, hasTextAIProviderConfigured } from "../../lib/ai-providers.js";
import { db } from "@workspace/db";
import { zakiyMemoryTable, journalEntriesTable, userProgressTable, notificationSettingsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { analyzeRisk } from "../../core/risk-engine.js";
import { getTodayTasks } from "../../core/task-engine.js";
import { decide } from "../../core/zakiy-engine.js";
import { loadMemory, updateMemory, savePromiseToMemory, buildMemorySection } from "./memory.js";
import { buildZakiySystemPrompt } from "./prompts.js";
import { generateSegmentedAudio } from "./segments.js";
import { generateZakiyResponse } from "./chat.js";

export type { ServerResponseSegment } from "./types.js";

const router: IRouter = Router();

function hasTextAiCredentials(): boolean {
  return hasTextAIProviderConfigured();
}

// ══════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════

router.post("/zakiy/message", async (req, res) => {
  try {
    if (!hasTextAiCredentials()) {
      res.status(503).json({
        error: "Zakiy AI is not configured on the server",
        configured: false,
      });
      return;
    }

    const { message, history = [], sessionId = "", voiceProfile } = req.body as {
      message: string;
      history: { role: "user" | "assistant"; content: string }[];
      sessionId?: string;
      voiceProfile?: string;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const memory = await loadMemory(sessionId);
    const responseText = await generateZakiyResponse(message, history, memory);
    const segments = await generateSegmentedAudio(responseText, voiceProfile);

    if (sessionId) {
      updateMemory(sessionId, message, responseText, memory).catch(() => {});
    }

    res.json({ response: responseText, segments });
  } catch {
    console.error("Zakiy message request failed");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

router.post("/zakiy/tts", async (req, res) => {
  try {
    const { text, voiceProfile } = req.body as { text: string; voiceProfile?: string };
    if (!text?.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const segments = await generateSegmentedAudio(text, voiceProfile);
    res.json({ segments });
  } catch {
    console.error("Zakiy TTS request failed");
    res.status(500).json({ error: "Failed to generate audio" });
  }
});

router.post("/zakiy/suggestions", async (req, res) => {
  try {
    const { history = [], sessionId = "" } = req.body as {
      history: { role: "user" | "assistant"; content: string }[];
      sessionId?: string;
    };

    const memory = await loadMemory(sessionId);
    const memorySection = buildMemorySection(memory);

    const lastExchange = history.slice(-4).map((m) => `${m.role === "user" ? "المستخدم" : "الزكي"}: ${m.content}`).join("\n");

    const raw = await generateText({
      maxTokens: 200,
      messages: [
        {
          role: "system",
          content: `أنت مساعد يقترح أسئلة متوقعة باللهجة المصرية العامية.
${memorySection}
بناءً على سياق المحادثة، اقترح 3 أسئلة قصيرة ومختلفة قد يسألها المستخدم كخطوة تالية.
أرجع JSON فقط بهذا الشكل:
{"suggestions": ["سؤال 1", "سؤال 2", "سؤال 3"]}
الأسئلة تكون: مختصرة (5-8 كلمات)، متنوعة، وباللهجة المصرية الطبيعية.`,
        },
        {
          role: "user",
          content: lastExchange || "بداية المحادثة",
        },
      ],
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [] };

    res.json({ suggestions: parsed.suggestions ?? [] });
  } catch {
    console.error("Zakiy suggestions request failed");
    res.json({ suggestions: [] });
  }
});

router.post("/zakiy/impression", async (req, res) => {
  try {
    const { history = [], sessionId = "" } = req.body as {
      history: { role: "user" | "assistant"; content: string }[];
      sessionId?: string;
    };

    const memory = await loadMemory(sessionId);

    const convSummary = history
      .slice(-10)
      .map((m) => `${m.role === "user" ? "المستخدم" : "الزكي"}: ${m.content.slice(0, 100)}`)
      .join("\n");

    const raw = await generateText({
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content: `أنت "الزكي" — الصاحب الروحاني الذكي الذي يلاحظ ويتذكر.
بناءً على المعلومات المتوفرة عن المستخدم وسياق المحادثة، اكتب انطباعاً شخصياً دافئاً وصادقاً عنه.

الذاكرة المتوفرة:
${JSON.stringify(memory, null, 2)}

قواعد الانطباع:
• ابدأ بجملة دافئة تشعره بأنك فاهمه
• اذكر صفة إيجابية ملاحظها
• اذكر تحدياً يمر به مع كلمة تشجيع
• اختم بجملة أمل وتفاؤل
• الطول: 4-5 جمل فقط، باللهجة المصرية الدافئة
• لو ما عندكش معلومات كافية، قول ذلك بصدق وشجعه على مزيد من الحديث`,
        },
        {
          role: "user",
          content: convSummary || "المستخدم لم يتحدث كثيراً بعد",
        },
      ],
    });

    const impression = raw || "لسه بتعرف بعضنا — كمّل الحديث وهشوفك أكتر!";
    res.json({ impression });
  } catch {
    console.error("Zakiy impression request failed");
    res.status(500).json({ error: "Failed to generate impression" });
  }
});

router.post("/zakiy/voice", async (req, res) => {
  try {
    const { audioBase64, history = [], sessionId = "", voiceProfile } = req.body as {
      audioBase64: string;
      history: { role: "user" | "assistant"; content: string }[];
      sessionId?: string;
      voiceProfile?: string;
    };

    if (!audioBase64) {
      res.status(400).json({ error: "audioBase64 is required" });
      return;
    }

    const rawBuffer = Buffer.from(audioBase64, "base64");
    const { buffer, format } = await ensureCompatibleFormat(rawBuffer);
    const transcript = await speechToText(buffer, format);

    if (!transcript?.trim()) {
      res.status(400).json({ error: "Could not transcribe audio" });
      return;
    }

    const memory = await loadMemory(sessionId);
    const responseText = await generateZakiyResponse(transcript, history, memory);
    const segments = await generateSegmentedAudio(responseText, voiceProfile);

    if (sessionId) {
      updateMemory(sessionId, transcript, responseText, memory).catch(() => {});
    }

    res.json({ transcript, response: responseText, segments });
  } catch {
    console.error("Zakiy voice request failed");
    res.status(500).json({ error: "Failed to process voice message" });
  }
});

router.post("/zakiy/promise", async (req, res) => {
  try {
    const { sessionId, promiseText } = req.body as { sessionId: string; promiseText: string };
    if (!sessionId || !promiseText?.trim()) {
      res.status(400).json({ error: "sessionId and promiseText required" });
      return;
    }
    await savePromiseToMemory(sessionId, promiseText.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("Promise save error:", err);
    res.status(500).json({ error: "Failed to save promise" });
  }
});

// ══════════════════════════════════════════
// RELAPSE RISK DETECTION
// ══════════════════════════════════════════

router.get("/zakiy/risk-check", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) { res.status(400).json({ error: "sessionId مطلوب" }); return; }

  try {
    const [memory, recentJournals, progress] = await Promise.all([
      loadMemory(sessionId),
      db.query.journalEntriesTable.findMany({
        where: eq(journalEntriesTable.sessionId, sessionId),
        orderBy: [desc(journalEntriesTable.createdAt)],
        limit: 5,
        columns: { content: true, mood: true, createdAt: true },
      }),
      db.query.userProgressTable.findFirst({
        where: eq(userProgressTable.sessionId, sessionId),
        columns: { streakDays: true, lastActiveDate: true, covenantDate: true },
      }),
    ]);

    const recentSlips = memory.slips?.slice(-3) ?? [];
    const brokenPromises = memory.promises?.filter((p) => p.broken) ?? [];

    const daysSinceActive = progress?.lastActiveDate
      ? Math.floor((Date.now() - new Date(progress.lastActiveDate).getTime()) / 86400000)
      : 0;

    const analysisPrompt = `أنت محلل نفسي متخصص في الصحة الروحية الإسلامية.
حلّل البيانات التالية وحدّد مستوى خطر الانتكاسة:

اليوميات الأخيرة (${recentJournals.length} مدخلات):
${recentJournals.map((j) => `- المزاج: ${j.mood ?? "غير محدد"} | المحتوى: "${String(j.content).slice(0, 100)}"`).join("\n")}

معلومات الذاكرة:
- زللات حديثة: ${recentSlips.map((s) => s.sin).join("، ") || "لا شيء"}
- وعود مكسورة: ${brokenPromises.length}
- الصفات: ${memory.traits.join("، ")}
- التحديات: ${memory.challenges.join("، ")}

بيانات التقدم:
- أيام التتابع: ${progress?.streakDays ?? 0}
- أيام منذ آخر نشاط: ${daysSinceActive}

أرجع JSON فقط:
{
  "riskLevel": "low" | "medium" | "high",
  "message": "رسالة دافئة ومختصرة من الزكي للمستخدم تناسب مستوى الخطر (جملتين فقط بالعربية)",
  "warningSign": "العلامة الأبرز التي تدل على الخطر (إن وجدت، وإلا null)"
}`;

    const raw = await generateText({
      maxTokens: 200,
      messages: [
        { role: "system", content: analysisPrompt },
        { role: "user", content: "حلّل وأرجع النتيجة" },
      ],
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { riskLevel: "low", message: "", warningSign: null };

    const riskLevel = result.riskLevel ?? "low";
    const risk = riskLevel === "low"
      ? null
      : { level: riskLevel as "medium" | "high", message: result.message ?? "", sign: result.warningSign ?? null };

    res.json({ ...result, risk });
  } catch {
    console.error("Zakiy risk check failed");
    res.json({ riskLevel: "low", message: "", warningSign: null, risk: null });
  }
});

// ══════════════════════════════════════════
// ANNIVERSARY MEMORY CHECK
// ══════════════════════════════════════════

router.get("/zakiy/anniversary", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) { res.status(400).json({ error: "sessionId مطلوب" }); return; }

  try {
    const progress = await db.query.userProgressTable.findFirst({
      where: eq(userProgressTable.sessionId, sessionId),
      columns: { covenantDate: true, streakDays: true },
    });

    if (!progress?.covenantDate) { res.json({ anniversary: null }); return; }

    const memory = await loadMemory(sessionId);
    const covenant = new Date(progress.covenantDate);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - covenant.getTime()) / 86400000);

    const MILESTONES: Record<number, string> = {
      7: "أسبوع",
      30: "شهر",
      40: "٤٠ يوماً",
      90: "٣ أشهر",
      180: "٦ أشهر",
      365: "سنة كاملة",
      730: "سنتان",
    };

    const milestone = MILESTONES[diffDays];
    if (!milestone) { res.json({ anniversary: null }); return; }

    const personalNote = memory.personalNote || "";
    const traits = memory.traits.join("، ");

    const msgPrompt = `أنت الزكي — الأخ الأكبر الحكيم في تطبيق دليل التوبة.
اليوم يمرّ ${milestone} على بدء المستخدم رحلة التوبة.
ما تعرفه عنه: ${traits || "لا شيء بعد"}.
ملاحظتك عنه: ${personalNote || "لم تتعرف عليه بعد"}.
اكتب رسالة قصيرة (٣-٤ جمل) تذكّره بهذه المحطة، وتشجّعه على الاستمرار.
أسلوبك: دافئ وصادق كالأخ الأكبر، ليس رسمياً.
لا تبدأ بـ "أنا" ولا بـ "الزكي".`;

    const messageText = await generateText({
      maxTokens: 200,
      messages: [
        { role: "user", content: msgPrompt },
      ],
    });

    const message = messageText.trim();

    res.json({
      anniversary: {
        milestone,
        daysCount: diffDays,
        covenantDate: progress.covenantDate,
        message,
      },
    });
  } catch {
    console.error("Zakiy anniversary check failed");
    res.json({ anniversary: null });
  }
});

// ══════════════════════════════════════════
// ZAKIY DECIDE — AI Mode Entry Point
// ══════════════════════════════════════════

router.post("/zakiy/decide", async (req, res) => {
  try {
    const { sessionId, trustLevel = 0 } = req.body as {
      sessionId: string;
      trustLevel?: number;
    };

    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    const progress = await db.query.userProgressTable.findFirst({
      where: eq(userProgressTable.sessionId, sessionId),
    });

    const inactiveDays = (() => {
      if (!progress?.lastActiveDate) return 0;
      const last = new Date(progress.lastActiveDate);
      const now = new Date();
      return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    })();

    const currentHour = new Date().getHours();

    let dangerHours: number[] = [];
    try {
      const notifRow = await db.query.notificationSettingsTable.findFirst({
        where: eq(notificationSettingsTable.sessionId, sessionId),
      });
      if (notifRow?.settingsJson) {
        const parsed = JSON.parse(notifRow.settingsJson) as { dangerHours?: number[] };
        dangerHours = parsed.dangerHours ?? [];
      }
    } catch {}

    const risk = analyzeRisk({
      inactiveDays,
      lastRelapse: null,
      streakDays: progress?.streakDays ?? 0,
      currentHour,
      dangerHours,
    });

    const todayTasks = await getTodayTasks(sessionId, progress?.currentPhase ?? 1);
    const memory = await loadMemory(sessionId);

    let memoryContext = { lastAdvice: "", lastTask: "", repetitionCount: 0 };
    let rawMemoryJson: Record<string, unknown> = {};
    try {
      const memRow = await db.query.zakiyMemoryTable.findFirst({
        where: eq(zakiyMemoryTable.sessionId, sessionId),
      });
      if (memRow?.memoryJson) {
        rawMemoryJson = JSON.parse(memRow.memoryJson) as Record<string, unknown>;
        memoryContext = {
          lastAdvice: (rawMemoryJson.lastAdvice as string) ?? "",
          lastTask: (rawMemoryJson.lastTask as string) ?? "",
          repetitionCount: (rawMemoryJson.repetitionCount as number) ?? 0,
        };
      }
    } catch {}

    const hour = currentHour;
    const timeOfDay =
      hour < 5 ? "ما قبل الفجر"
      : hour < 7 ? "وقت الفجر"
      : hour < 12 ? "الصباح"
      : hour < 14 ? "وقت الظهر"
      : hour < 17 ? "بعد الظهر"
      : hour < 19 ? "وقت العصر"
      : hour < 21 ? "المغرب والعشاء"
      : "الليل";

    const decision = await decide({
      sessionId,
      streakDays: progress?.streakDays ?? 0,
      inactiveDays,
      sinCategory: progress?.sinCategory ?? "other",
      riskScore: risk.score,
      currentPhase: progress?.currentPhase ?? 1,
      covenantSigned: progress?.covenantSigned ?? false,
      trustLevel,
      todayTasks,
      timeOfDay,
      memoryTraits: memory.traits,
      memoryContext,
    });

    try {
      const isRepeat =
        memoryContext.lastAdvice !== "" &&
        decision.action.target === memoryContext.lastAdvice;

      const newMemoryJson = JSON.stringify({
        ...rawMemoryJson,
        lastAdvice: decision.action.target,
        lastTask: decision.task?.id ?? memoryContext.lastTask,
        repetitionCount: isRepeat ? memoryContext.repetitionCount + 1 : 1,
      });

      db.insert(zakiyMemoryTable)
        .values({ sessionId, memoryJson: newMemoryJson })
        .onConflictDoUpdate({
          target: zakiyMemoryTable.sessionId,
          set: { memoryJson: newMemoryJson },
        })
        .catch(() => {});
    } catch {}

    const safeMessage = decision.message?.trim() || "ابدأ بخطوة صغيرة — الله يستر ويعين.";
    const safeTarget = decision.action?.target || "/dhikr";
    const safeLabel = decision.actionLabel?.trim() || "ابدأ الآن";

    res.json({
      ...decision,
      message: safeMessage,
      action: { type: "redirect", target: safeTarget },
      actionLabel: safeLabel,
      riskScore: risk.score,
      riskTriggers: risk.triggers,
    });
  } catch {
    console.error("[zakiy/decide] request failed");
    res.json({
      message: "ابدأ بحاجة بسيطة… ذكر خفيف هيظبطك.",
      action: { type: "redirect", target: "/dhikr" },
      actionLabel: "ابدأ ذكر",
      urgency: "low",
      decisionType: "growth",
      riskScore: 0,
      riskTriggers: [],
    });
  }
});

export default router;
