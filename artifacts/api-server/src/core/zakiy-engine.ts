import { generateText } from "../lib/ai-providers.js";
import type { UnifiedTask } from "./task-engine.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type DecisionType = "emergency" | "repentance" | "stabilize" | "growth";

export interface ZakiyContext {
  sessionId: string;
  streakDays: number;
  inactiveDays: number;
  sinCategory: string;
  riskScore: number;
  currentPhase: number;
  covenantSigned: boolean;
  trustLevel: number;
  todayTasks: UnifiedTask[];
  timeOfDay: string;
  memoryTraits?: string[];
  memoryContext?: {
    lastAdvice: string;
    lastTask: string;
    repetitionCount: number;
  };
}

export interface ZakiyDecision {
  message: string;
  action: { type: "redirect"; target: string };
  actionLabel: string;
  urgency: "low" | "medium" | "high" | "emergency";
  decisionType: DecisionType;
  task?: UnifiedTask;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AI_TIMEOUT_MS = 2000;

const SAFE_FALLBACK: ZakiyDecision = {
  message: "ابدأ بحاجة بسيطة… ذكر خفيف هيظبطك.",
  action: { type: "redirect", target: "/dhikr" },
  actionLabel: "ابدأ ذكر",
  urgency: "low",
  decisionType: "growth",
};

const VALID_ROUTES = new Set([
  "/dhikr", "/sos", "/relapse", "/covenant", "/journey",
  "/day-one", "/habits", "/hadi-tasks", "/progress", "/quran",
  "/prayer-times", "/journal", "/munajat", "/rajaa", "/kaffarah",
  "/signs", "/danger-times", "/zakiy",
]);

// Pre-defined fallback messages by DecisionType — used when AI times out
const FALLBACK_MESSAGES: Record<DecisionType, string> = {
  emergency: "لازم تتحرك دلوقتي — مش وقت التأجيل.",
  repentance: "رجوع للطريق أهم من الوقوع — كل لحظة فرصة.",
  stabilize: "ثبّت نفسك بالذكر — هو الأساس اللي بيحمي.",
  growth: "استمرارك هو الانتصار — خطوة صغيرة كل يوم.",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function validateRoute(route: string): string {
  return VALID_ROUTES.has(route) ? route : "/dhikr";
}

async function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  ms: number
): Promise<T> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("ai_timeout")), ms)
  );
  return Promise.race([promise, timer]).catch(() => fallback);
}

// ── Decision Logic (Rule-Based Only) ──────────────────────────────────────────

function chooseTarget(ctx: ZakiyContext): {
  target: string;
  actionLabel: string;
  urgency: ZakiyDecision["urgency"];
  decisionType: DecisionType;
  task?: UnifiedTask;
} {
  // Emergency
  if (ctx.riskScore > 0.9) {
    return {
      target: "/sos",
      actionLabel: "افتح طوارئ التوبة",
      urgency: "emergency",
      decisionType: "emergency",
    };
  }

  // Repentance — long inactivity
  if (ctx.inactiveDays >= 3) {
    return {
      target: "/relapse",
      actionLabel: "اقرأ عن الانتكاسة",
      urgency: "high",
      decisionType: "repentance",
    };
  }

  // Stabilize — no covenant yet
  if (!ctx.covenantSigned) {
    return {
      target: "/covenant",
      actionLabel: "وقّع عهد التوبة",
      urgency: "high",
      decisionType: "stabilize",
    };
  }

  // Stabilize — incomplete required tasks
  const incompleteRequired = ctx.todayTasks.find(
    (t) => t.priority === "required" && !t.completed
  );
  if (incompleteRequired) {
    return {
      target: validateRoute(incompleteRequired.route ?? "/day-one"),
      actionLabel: incompleteRequired.title,
      urgency: "medium",
      decisionType: "stabilize",
      task: incompleteRequired,
    };
  }

  // Growth — recommended tasks
  const incompleteRecommended = ctx.todayTasks.find(
    (t) => t.priority === "recommended" && !t.completed
  );
  if (incompleteRecommended) {
    return {
      target: validateRoute(incompleteRecommended.route ?? "/habits"),
      actionLabel: incompleteRecommended.title,
      urgency: "medium",
      decisionType: "growth",
      task: incompleteRecommended,
    };
  }

  // Growth — journey continuation
  if (ctx.covenantSigned) {
    return {
      target: "/journey",
      actionLabel: "تابع رحلتك",
      urgency: "low",
      decisionType: "growth",
    };
  }

  // Default
  return {
    target: "/dhikr",
    actionLabel: "ابدأ الذكر الآن",
    urgency: "low",
    decisionType: "growth",
  };
}

// ── AI Message Generation (Expression Only) ───────────────────────────────────

const DECISION_TYPE_HINTS: Record<DecisionType, string> = {
  emergency:
    "الموقف طارئ — أسلوبك حازم لكن محبب ومشجع على العودة الفورية. ليس مخيفاً.",
  repentance:
    "غاب المستخدم فترة — أسلوبك دافئ ومرحّب، يذكّره أن الباب مفتوح دائماً.",
  stabilize:
    "المستخدم بحاجة لتثبيت — أسلوبك مباشر ومشجع لاتخاذ خطوة واحدة محددة.",
  growth:
    "المستخدم في مرحلة نمو — أسلوبك إيجابي ومحفّز للاستمرار والتقدم.",
};

async function generateMessage(
  ctx: ZakiyContext,
  target: string,
  decisionType: DecisionType,
  urgency: ZakiyDecision["urgency"]
): Promise<string> {
  const traits =
    ctx.memoryTraits && ctx.memoryTraits.length > 0
      ? `ما تعرفه عنه: ${ctx.memoryTraits.join("، ")}.`
      : "";

  const repetitionNote =
    ctx.memoryContext && ctx.memoryContext.repetitionCount > 1
      ? `⚠️ قُلت له هذا النوع من الرسائل ${ctx.memoryContext.repetitionCount} مرة — استخدم أسلوباً مختلفاً تماماً هذه المرة.`
      : "";

  const prompt = `أنت الزكي — الأخ الأكبر الحكيم في تطبيق دليل التوبة.
${traits}
${DECISION_TYPE_HINTS[decisionType]}
${repetitionNote}

السياق الكامل:
- نوع القرار: ${decisionType}
- مستوى الخطر: ${(ctx.riskScore * 100).toFixed(0)}%
- أيام الالتزام المتواصلة: ${ctx.streakDays}
- أيام الغياب: ${ctx.inactiveDays}
- وقت اليوم: ${ctx.timeOfDay}
- سيتوجه لـ: ${target}

اكتب رسالة قصيرة (جملتان أو ثلاث بالعربية) تناسب هذا الوضع تحديداً.
لا تبدأ بـ "أنا" أو "الزكي". لا تذكر اسم التطبيق.
الرسالة موجهة مباشرة للمستخدم.`;

  const aiCall = generateText({
    maxTokens: 120,
    timeoutMs: AI_TIMEOUT_MS,
    messages: [{ role: "user", content: prompt }],
  }).then((text) => text.trim());

  const result = await withTimeout(aiCall, FALLBACK_MESSAGES[decisionType], AI_TIMEOUT_MS);
  return result || FALLBACK_MESSAGES[decisionType];
}

// ── Response Validation ────────────────────────────────────────────────────────

function validateDecision(d: ZakiyDecision): ZakiyDecision {
  if (!d.message || d.message.trim().length === 0) {
    d.message = FALLBACK_MESSAGES[d.decisionType];
  }
  if (!d.action?.target) {
    d.action = { type: "redirect", target: "/dhikr" };
  }
  d.action.target = validateRoute(d.action.target);
  if (!d.actionLabel || d.actionLabel.trim().length === 0) {
    d.actionLabel = "ابدأ الآن";
  }
  return d;
}

// ── Main Entry Point ───────────────────────────────────────────────────────────

export async function decide(ctx: ZakiyContext): Promise<ZakiyDecision> {
  try {
    const { target, actionLabel, urgency, decisionType, task } =
      chooseTarget(ctx);

    const message = await generateMessage(ctx, target, decisionType, urgency);

    const decision: ZakiyDecision = {
      message,
      action: { type: "redirect", target },
      actionLabel,
      urgency,
      decisionType,
      task,
    };

    const validated = validateDecision(decision);

    // Structured logging for debugging
    console.log("[ZAKIY]", {
      decisionType: validated.decisionType,
      riskScore: ctx.riskScore,
      task: task?.id ?? null,
      target: validated.action.target,
      trustLevel: ctx.trustLevel,
      urgency: validated.urgency,
      inactiveDays: ctx.inactiveDays,
      streakDays: ctx.streakDays,
    });

    return validated;
  } catch {
    console.error("[ZAKIY] decide() failed — returning safe fallback");
    return { ...SAFE_FALLBACK };
  }
}

// ── Future Hook (Placeholder) ──────────────────────────────────────────────────
// TODO: Implement predictive risk scoring before relapse occurs
// This will allow Zakiy to act BEFORE the user relapses, not after.
//
// export async function predictRisk(ctx: ZakiyContext): Promise<number> {
//   // Will use historical patterns + ML model to predict riskScore 24h ahead
//   throw new Error("Not implemented yet");
// }
