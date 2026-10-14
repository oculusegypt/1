import { Router, type IRouter } from "express";
import { speechToText, ensureCompatibleFormat } from "@workspace/integrations-openai-ai-server/audio";
import { generateText } from "../lib/ai-providers.js";
import { db } from "@workspace/db";
import {
  userProgressTable,
  usersTable,
  habitsTable,
  dhikrCountTable,
  kaffarahStepsTable,
  journalEntriesTable,
  globalStatsTable,
  challengesTable,
  secretDuasTable,
  communityDuasTable,
  notificationSettingsTable,
  appInboxTable,
} from "@workspace/db/schema";
import { eq, and, desc, count, gte, sql, ne, isNull, or } from "drizzle-orm";
import {
  GetUserProgressResponse,
  UpdateUserProgressBody,
  CreateCovenantBody,
  CompleteHabitBody,
  IncrementDhikrBody,
} from "@workspace/api-zod";
import { requireAuth, optionalAuth, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

const TODAY_HABITS = [
  { key: "wudu", nameAr: "توضأ الآن" },
  { key: "salat_tawba", nameAr: "صلِّ ركعتين بنية التوبة" },
  { key: "delete_apps", nameAr: "احذف التطبيقات المحرمة" },
  { key: "change_env", nameAr: "غيّر بيئتك" },
];

// ── مكتبة العادات الـ 50 ─────────────────────────────────────────────────────
type HabitLevel = "easy" | "medium" | "advanced";

interface HabitTemplate {
  key: string;
  nameAr: string;
  level: HabitLevel;
}

const HABITS_LIBRARY: HabitTemplate[] = [
  // ── سهل (18) ─────────────────────────────────────────────────
  { key: "wudu",              nameAr: "الوضوء قبل النوم",                        level: "easy" },
  { key: "salat_tawba",       nameAr: "ركعتا التوبة",                            level: "easy" },
  { key: "bismillah",         nameAr: "البسملة قبل كل عمل",                      level: "easy" },
  { key: "fatiha_3x",        nameAr: "قراءة الفاتحة 3 مرات صباحاً",             level: "easy" },
  { key: "istighfar_10",      nameAr: "الاستغفار 10 مرات بعد الصلاة",            level: "easy" },
  { key: "salawat_10",        nameAr: "الصلاة على النبي ﷺ 10 مرات",              level: "easy" },
  { key: "no_phone_fajr",     nameAr: "عدم استخدام الهاتف بعد الفجر ساعة",       level: "easy" },
  { key: "sadaqa_small",      nameAr: "صدقة ولو بكلمة طيبة",                    level: "easy" },
  { key: "quran_page",        nameAr: "قراءة صفحة واحدة من القرآن",               level: "easy" },
  { key: "subhana_33",        nameAr: "سبحان الله 33 مرة بعد الصلاة",            level: "easy" },
  { key: "ayah_kursi",        nameAr: "آية الكرسي قبل النوم",                      level: "easy" },
  { key: "muawwizatain",      nameAr: "المعوذتين قبل النوم",                      level: "easy" },
  { key: "smile_sadaqa",      nameAr: "الابتسامة في وجه المسلم",                  level: "easy" },
  { key: "water_niyyah",      nameAr: "شرب الماء بنية الاستعانة على العبادة",     level: "easy" },
  { key: "morning_azkar",     nameAr: "أذكار الصباح المختصرة",                    level: "easy" },
  { key: "evening_azkar",     nameAr: "أذكار المساء المختصرة",                    level: "easy" },
  { key: "no_haram_look",     nameAr: "غض البصر طوال اليوم",                      level: "easy" },
  { key: "dua_before_sleep",  nameAr: "الدعاء عند النوم باسم الله",               level: "easy" },

  // ── متوسط (17) ────────────────────────────────────────────────
  { key: "istighfar_100",     nameAr: "ورد الاستغفار 100 مرة يومياً",              level: "medium" },
  { key: "quran_2pages",      nameAr: "قراءة صفحتين من القرآن",                   level: "medium" },
  { key: "witr",              nameAr: "صلاة الوتر قبل النوم",                     level: "medium" },
  { key: "sayyid_morning",    nameAr: "سيد الاستغفار صباحاً",                     level: "medium" },
  { key: "sayyid_evening",    nameAr: "سيد الاستغفار مساءً",                      level: "medium" },
  { key: "full_azkar",        nameAr: "أذكار الصباح والمساء كاملة",                level: "medium" },
  { key: "rawatib_prayers",   nameAr: "السنن الرواتب (12 ركعة يومياً)",            level: "medium" },
  { key: "quran_tafsir",      nameAr: "قراءة آية مع تفسيرها",                     level: "medium" },
  { key: "sadaqa_daily",      nameAr: "الصدقة اليومية ولو درهماً",                 level: "medium" },
  { key: "no_sin_hour",       nameAr: "ساعة خالية من الذنوب والغفلة",              level: "medium" },
  { key: "duha_pray",         nameAr: "صلاة الضحى (ركعتان على الأقل)",             level: "medium" },
  { key: "hadith_read",       nameAr: "قراءة حديث شريف والعمل به",                 level: "medium" },
  { key: "parents_dua",       nameAr: "الدعاء للوالدين بعد كل صلاة",              level: "medium" },
  { key: "zikr_100",          nameAr: "ذكر (سبحان الله وبحمده) 100 مرة",          level: "medium" },
  { key: "fasting_white",     nameAr: "صيام الأيام البيض (13, 14, 15)",            level: "medium" },
  { key: "journal_tawbah",    nameAr: "كتابة يومية في مفكرة التوبة",               level: "medium" },
  { key: "tahajjud_2rak",     nameAr: "ركعتا تهجد في آخر الليل",                  level: "medium" },

  // ── متقدم (15) ────────────────────────────────────────────────
  { key: "juz_daily",         nameAr: "قراءة جزء كامل من القرآن يومياً",           level: "advanced" },
  { key: "tahajjud_full",     nameAr: "قيام الليل (ثلث الليل الأخير)",             level: "advanced" },
  { key: "fasting_weekly",    nameAr: "صيام الاثنين والخميس",                      level: "advanced" },
  { key: "sadaqa_10pct",      nameAr: "الصدقة بعُشر الدخل اليومي",                 level: "advanced" },
  { key: "no_sin_day",        nameAr: "يوم كامل خالٍ من الذنوب الظاهرة",           level: "advanced" },
  { key: "memorize_ayah",     nameAr: "حفظ آية كريمة جديدة يومياً",               level: "advanced" },
  { key: "istighfar_1000",    nameAr: "الاستغفار 1000 مرة في اليوم",               level: "advanced" },
  { key: "complete_azkar",    nameAr: "جميع الأذكار المسنونة طوال اليوم",           level: "advanced" },
  { key: "silat_rahim",       nameAr: "صلة رحم بالزيارة أو المكالمة",              level: "advanced" },
  { key: "repent_immediately", nameAr: "التوبة الفورية عند أي ذنب",                level: "advanced" },
  { key: "nawafil_extra",     nameAr: "20 ركعة نافلة إضافية",                      level: "advanced" },
  { key: "surah_baqarah",     nameAr: "قراءة سورة البقرة كاملة",                   level: "advanced" },
  { key: "itikaaf_hour",      nameAr: "ساعة اعتكاف في المسجد",                     level: "advanced" },
  { key: "khushu_salat",      nameAr: "الصلاة بخشوع تام (تدبّر كل ركعة)",          level: "advanced" },
  { key: "dawah_share",       nameAr: "مشاركة نصيحة إسلامية مع شخص آخر",           level: "advanced" },
];

// اختيار العادات اليومية حسب عمر المستخدم في التوبة
function selectDailyHabits(dayProgress: number, sessionId: string, date: string): HabitTemplate[] {
  // مرحلة البداية (1-7): 4 سهل، 1 متوسط
  // مرحلة التثبيت (8-20): 3 سهل، 2 متوسط
  // مرحلة التعمّق (21-35): 2 سهل، 2 متوسط، 1 متقدم
  // مرحلة الإتقان (36+): 1 سهل، 2 متوسط، 2 متقدم
  let easyCount = 4, mediumCount = 1, advancedCount = 0;
  if (dayProgress >= 36) { easyCount = 1; mediumCount = 2; advancedCount = 2; }
  else if (dayProgress >= 21) { easyCount = 2; mediumCount = 2; advancedCount = 1; }
  else if (dayProgress >= 8) { easyCount = 3; mediumCount = 2; advancedCount = 0; }

  const easy    = HABITS_LIBRARY.filter(h => h.level === "easy");
  const medium  = HABITS_LIBRARY.filter(h => h.level === "medium");
  const advanced = HABITS_LIBRARY.filter(h => h.level === "advanced");

  // اختيار شبه عشوائي ولكن محدد لكل يوم وجلسة
  const seed = Array.from(sessionId + date).reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = <T,>(arr: T[], n: number, offset = 0): T[] => {
    const result: T[] = [];
    const len = arr.length;
    for (let i = 0; i < n && i < len; i++) {
      result.push(arr[(seed + offset + i * 7) % len]!);
    }
    return result;
  };

  return [
    ...pick(easy, easyCount, 0),
    ...pick(medium, mediumCount, 31),
    ...pick(advanced, advancedCount, 67),
  ];
}

const DAILY_HABITS = [
  { key: "istighfar_100", nameAr: "ورد الاستغفار (100 مرة)" },
  { key: "quran", nameAr: "قراءة صفحتين من القرآن" },
  { key: "witr", nameAr: "صلاة الوتر" },
  { key: "sayyid_morning", nameAr: "سيد الاستغفار صباحاً" },
  { key: "sayyid_evening", nameAr: "سيد الاستغفار مساءً" },
];

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

router.get("/user/progress", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  let progress = await db.query.userProgressTable.findFirst({
    where: eq(userProgressTable.sessionId, sessionId),
  });

  if (!progress) {
    const [created] = await db
      .insert(userProgressTable)
      .values({
        sessionId,
        sinCategory: "other",
        covenantSigned: false,
        currentPhase: 1,
        day40Progress: 0,
        firstDayTasksCompleted: false,
        streakDays: 0,
      })
      .returning();
    progress = created;
  }

  const formatted = {
    id: progress.id,
    sessionId: progress.sessionId,
    sinCategory: progress.sinCategory,
    covenantSigned: progress.covenantSigned,
    covenantDate: progress.covenantDate ? progress.covenantDate.toISOString() : null,
    currentPhase: progress.currentPhase,
    day40Progress: progress.day40Progress,
    firstDayTasksCompleted: progress.firstDayTasksCompleted,
    streakDays: progress.streakDays,
    lastActiveDate: progress.lastActiveDate ?? null,
  };

  res.json(GetUserProgressResponse.parse(formatted));
});

router.put("/user/progress", async (req, res) => {
  const body = UpdateUserProgressBody.parse(req.body);

  let progress = await db.query.userProgressTable.findFirst({
    where: eq(userProgressTable.sessionId, body.sessionId),
  });

  if (!progress) {
    const [created] = await db
      .insert(userProgressTable)
      .values({
        sessionId: body.sessionId,
        sinCategory: "other",
        covenantSigned: false,
        currentPhase: body.currentPhase ?? 1,
        day40Progress: body.day40Progress ?? 0,
        firstDayTasksCompleted: body.firstDayTasksCompleted ?? false,
        streakDays: body.streakDays ?? 0,
        lastActiveDate: todayStr(),
      })
      .returning();
    progress = created;
  } else {
    const updates: Record<string, unknown> = { lastActiveDate: todayStr() };
    if (body.currentPhase !== undefined) updates.currentPhase = body.currentPhase;
    if (body.day40Progress !== undefined) updates.day40Progress = body.day40Progress;
    if (body.firstDayTasksCompleted !== undefined) updates.firstDayTasksCompleted = body.firstDayTasksCompleted;
    if (body.streakDays !== undefined) updates.streakDays = body.streakDays;

    const [updated] = await db
      .update(userProgressTable)
      .set(updates)
      .where(eq(userProgressTable.sessionId, body.sessionId))
      .returning();
    progress = updated;
  }

  const formatted = {
    id: progress.id,
    sessionId: progress.sessionId,
    sinCategory: progress.sinCategory,
    covenantSigned: progress.covenantSigned,
    covenantDate: progress.covenantDate ? progress.covenantDate.toISOString() : null,
    currentPhase: progress.currentPhase,
    day40Progress: progress.day40Progress,
    firstDayTasksCompleted: progress.firstDayTasksCompleted,
    streakDays: progress.streakDays,
    lastActiveDate: progress.lastActiveDate ?? null,
  };

  res.json(formatted);
});

router.post("/user/covenant", async (req, res) => {
  const body = CreateCovenantBody.parse(req.body);

  let progress = await db.query.userProgressTable.findFirst({
    where: eq(userProgressTable.sessionId, body.sessionId),
  });

  if (!progress) {
    const [created] = await db
      .insert(userProgressTable)
      .values({
        sessionId: body.sessionId,
        sinCategory: body.sinCategory,
        covenantSigned: true,
        covenantDate: new Date(),
        currentPhase: 2,
        day40Progress: 0,
        firstDayTasksCompleted: false,
        streakDays: 0,
        lastActiveDate: todayStr(),
      })
      .returning();
    progress = created;
  } else {
    const [updated] = await db
      .update(userProgressTable)
      .set({
        sinCategory: body.sinCategory,
        covenantSigned: true,
        covenantDate: new Date(),
        currentPhase: 2,
        lastActiveDate: todayStr(),
      })
      .where(eq(userProgressTable.sessionId, body.sessionId))
      .returning();
    progress = updated;
  }

  const formatted = {
    id: progress.id,
    sessionId: progress.sessionId,
    sinCategory: progress.sinCategory,
    covenantSigned: progress.covenantSigned,
    covenantDate: progress.covenantDate ? progress.covenantDate.toISOString() : null,
    currentPhase: progress.currentPhase,
    day40Progress: progress.day40Progress,
    firstDayTasksCompleted: progress.firstDayTasksCompleted,
    streakDays: progress.streakDays,
    lastActiveDate: progress.lastActiveDate ?? null,
  };

  res.json(formatted);
});

router.get("/user/journey", optionalAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.auth?.sub) {
    return void res.json(null);
  }
  const userId = Number(req.auth.sub);
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) return void res.json(null);

  const sessionId = `user_${userId}`;
  const progress = await db.query.userProgressTable.findFirst({
    where: eq(userProgressTable.sessionId, sessionId),
  });

  if (!progress || !progress.covenantSigned) {
    return void res.json({ active: false, progress: 0, totalDays: 40, hasSin: false });
  }

  const hasSin = !!(progress.sinIds && progress.sinIds.trim() !== "[]");
  const totalDays = 40;
  const pct = Math.min(100, Math.round((progress.day40Progress / totalDays) * 100));

  return void res.json({
    active: true,
    progress: pct,
    totalDays,
    hasSin,
    day: progress.day40Progress,
  });
});

router.put("/user/sins", optionalAuth, async (req: AuthenticatedRequest, res) => {
  const { sinIds, sessionId: guestSessionId } = req.body ?? {};
  const sessionId = req.auth?.sub
    ? `user_${Number(req.auth.sub)}`
    : (guestSessionId as string | undefined)?.trim() || null;

  if (!sessionId) {
    return void res.status(400).json({ error: "sessionId required" });
  }

  if (!Array.isArray(sinIds)) {
    return void res.status(400).json({ error: "sinIds must be an array" });
  }

  const sinIdsJson = JSON.stringify(sinIds);

  const existing = await db.query.userProgressTable.findFirst({
    where: eq(userProgressTable.sessionId, sessionId),
  });

  if (existing) {
    await db
      .update(userProgressTable)
      .set({ sinIds: sinIdsJson })
      .where(eq(userProgressTable.sessionId, sessionId));
  } else {
    await db.insert(userProgressTable).values({
      sessionId,
      sinCategory: sinIds[0] ?? "other",
      sinIds: sinIdsJson,
      covenantSigned: false,
      currentPhase: 1,
      day40Progress: 0,
      firstDayTasksCompleted: false,
      streakDays: 0,
    });
  }

  return void res.json({ ok: true });
});

router.get("/habits", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const dateStr = (req.query.date as string) || todayStr();
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  const progress = await db.query.userProgressTable.findFirst({
    where: eq(userProgressTable.sessionId, sessionId),
  });

  const dayProgress = progress?.day40Progress ?? 0;
  const habitTemplates = progress?.firstDayTasksCompleted
    ? selectDailyHabits(dayProgress, sessionId, dateStr)
    : TODAY_HABITS;

  let habits = await db.query.habitsTable.findMany({
    where: and(
      eq(habitsTable.sessionId, sessionId),
      eq(habitsTable.date, dateStr)
    ),
  });

  if (habits.length === 0) {
    const inserted = await db
      .insert(habitsTable)
      .values(
        habitTemplates.map((h) => ({
          sessionId,
          habitKey: h.key,
          habitNameAr: h.nameAr,
          completed: false,
          date: dateStr,
        }))
      )
      .returning();
    habits = inserted;
  }

  res.json(habits.map((h) => ({
    id: h.id,
    sessionId: h.sessionId,
    habitKey: h.habitKey,
    habitNameAr: h.habitNameAr,
    completed: h.completed,
    date: h.date,
  })));
});

router.post("/habits", async (req, res) => {
  const body = CompleteHabitBody.parse(req.body);
  const dateStr = todayStr();

  const existing = await db.query.habitsTable.findFirst({
    where: and(
      eq(habitsTable.sessionId, body.sessionId),
      eq(habitsTable.habitKey, body.habitKey),
      eq(habitsTable.date, dateStr)
    ),
  });

  if (!existing) {
    return void res.status(404).json({ error: "Habit not found" });
  }

  const [updated] = await db
    .update(habitsTable)
    .set({ completed: body.completed })
    .where(and(
      eq(habitsTable.sessionId, body.sessionId),
      eq(habitsTable.habitKey, body.habitKey),
      eq(habitsTable.date, dateStr)
    ))
    .returning();

  res.json({
    id: updated.id,
    sessionId: updated.sessionId,
    habitKey: updated.habitKey,
    habitNameAr: updated.habitNameAr,
    completed: updated.completed,
    date: updated.date,
  });
});

router.get("/dhikr/count", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const dateStr = (req.query.date as string) || todayStr();
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  let dhikr = await db.query.dhikrCountTable.findFirst({
    where: and(
      eq(dhikrCountTable.sessionId, sessionId),
      eq(dhikrCountTable.date, dateStr)
    ),
  });

  if (!dhikr) {
    const [created] = await db
      .insert(dhikrCountTable)
      .values({ sessionId, date: dateStr, istighfar: 0, tasbih: 0, sayyid: 0 })
      .returning();
    dhikr = created;
  }

  res.json({
    sessionId: dhikr.sessionId,
    date: dhikr.date,
    istighfar: dhikr.istighfar,
    tasbih: dhikr.tasbih,
    sayyid: dhikr.sayyid,
  });
});

router.post("/dhikr/increment", async (req, res) => {
  const body = IncrementDhikrBody.parse(req.body);
  const dateStr = todayStr();

  let dhikr = await db.query.dhikrCountTable.findFirst({
    where: and(
      eq(dhikrCountTable.sessionId, body.sessionId),
      eq(dhikrCountTable.date, dateStr)
    ),
  });

  if (!dhikr) {
    const [created] = await db
      .insert(dhikrCountTable)
      .values({ sessionId: body.sessionId, date: dateStr, istighfar: 0, tasbih: 0, sayyid: 0 })
      .returning();
    dhikr = created;
  }

  if (!dhikr) {
    return res.status(500).json({ error: "Failed to initialize dhikr record" });
  }

  const VALID_DHIKR_TYPES = ["istighfar", "tasbih", "sayyid"] as const;
  if (!VALID_DHIKR_TYPES.includes(body.dhikrType as "istighfar" | "tasbih" | "sayyid")) {
    return res.status(400).json({ error: "dhikrType must be one of: istighfar, tasbih, sayyid" });
  }
  const col = body.dhikrType as "istighfar" | "tasbih" | "sayyid";
  const newVal = (dhikr[col] ?? 0) + body.amount;

  const updateData: Record<string, number> = {};
  updateData[col] = newVal;

  const [updated] = await db
    .update(dhikrCountTable)
    .set(updateData)
    .where(and(
      eq(dhikrCountTable.sessionId, body.sessionId),
      eq(dhikrCountTable.date, dateStr)
    ))
    .returning();

  if (!updated) {
    return res.status(500).json({ error: "Failed to update dhikr record" });
  }

  return res.json({
    sessionId: updated.sessionId,
    date: updated.date,
    istighfar: updated.istighfar,
    tasbih: updated.tasbih,
    sayyid: updated.sayyid,
  });
});

router.post("/dhikr/reset", async (req, res) => {
  const sessionId = req.body.sessionId as string;
  const dhikrType = req.body.dhikrType as "istighfar" | "tasbih" | "sayyid" | undefined;
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });
  const dateStr = todayStr();

  const resetData: Record<string, number> = dhikrType
    ? { [dhikrType]: 0 }
    : { istighfar: 0, tasbih: 0, sayyid: 0 };

  await db
    .update(dhikrCountTable)
    .set(resetData)
    .where(and(
      eq(dhikrCountTable.sessionId, sessionId),
      eq(dhikrCountTable.date, dateStr)
    ));

  res.json({ success: true });
});

// ==================== KAFFARAH ROUTES ====================

router.get("/kaffarah", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  const steps = await db.query.kaffarahStepsTable.findMany({
    where: eq(kaffarahStepsTable.sessionId, sessionId),
  });

  res.json(steps.map((s) => ({
    id: s.id,
    sessionId: s.sessionId,
    stepKey: s.stepKey,
    completed: s.completed,
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
  })));
});

router.post("/kaffarah/complete", async (req, res) => {
  const { sessionId, stepKey, completed } = req.body as { sessionId: string; stepKey: string; completed: boolean };
  if (!sessionId || !stepKey) return void res.status(400).json({ error: "sessionId and stepKey required" });

  const existing = await db.query.kaffarahStepsTable.findFirst({
    where: and(
      eq(kaffarahStepsTable.sessionId, sessionId),
      eq(kaffarahStepsTable.stepKey, stepKey)
    ),
  });

  if (existing) {
    const [updated] = await db
      .update(kaffarahStepsTable)
      .set({ completed, completedAt: completed ? new Date() : null })
      .where(and(
        eq(kaffarahStepsTable.sessionId, sessionId),
        eq(kaffarahStepsTable.stepKey, stepKey)
      ))
      .returning();
    return void res.json({ id: updated.id, sessionId: updated.sessionId, stepKey: updated.stepKey, completed: updated.completed, completedAt: updated.completedAt ? updated.completedAt.toISOString() : null });
  }

  const [created] = await db
    .insert(kaffarahStepsTable)
    .values({ sessionId, stepKey, completed, completedAt: completed ? new Date() : null })
    .returning();

  res.json({ id: created.id, sessionId: created.sessionId, stepKey: created.stepKey, completed: created.completed, completedAt: created.completedAt ? created.completedAt.toISOString() : null });
});

// ==================== JOURNAL ROUTES ====================

router.get("/journal", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  const entries = await db.query.journalEntriesTable.findMany({
    where: eq(journalEntriesTable.sessionId, sessionId),
    orderBy: [desc(journalEntriesTable.createdAt)],
  });

  res.json(entries.map((e) => ({
    id: e.id,
    sessionId: e.sessionId,
    content: e.content,
    mood: e.mood,
    date: e.date,
    createdAt: e.createdAt ? e.createdAt.toISOString() : null,
  })));
});

router.post("/journal", async (req, res) => {
  const { sessionId, content, mood } = req.body as { sessionId: string; content: string; mood: string };
  if (!sessionId || !content) return void res.status(400).json({ error: "sessionId and content required" });

  const dateStr = todayStr();
  const [entry] = await db
    .insert(journalEntriesTable)
    .values({ sessionId, content, mood: mood || "neutral", date: dateStr })
    .returning();

  res.json({
    id: entry.id,
    sessionId: entry.sessionId,
    content: entry.content,
    mood: entry.mood,
    date: entry.date,
    createdAt: entry.createdAt ? entry.createdAt.toISOString() : null,
  });
});

router.delete("/journal/:id", async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  const id = parseInt(req.params.id);
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  await db.query.journalEntriesTable.findFirst({
    where: and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.sessionId, sessionId)),
  });

  await db
    .delete(journalEntriesTable)
    .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.sessionId, sessionId)));

  res.json({ success: true });
});

router.post("/stats/event", async (req, res) => {
  const { eventType } = req.body as { eventType: string };
  const validEvents = ["tawbah", "dhikr", "covenant", "dua", "quran"];
  if (!eventType || !validEvents.includes(eventType)) {
    return void res.status(400).json({ error: "invalid eventType" });
  }
  await db.insert(globalStatsTable).values({
    eventType,
    date: todayStr(),
  });
  res.json({ success: true });
});

router.get("/stats/live", async (_req, res) => {
  const today = todayStr();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  const [todayRows, totalRows, weekRows] = await Promise.all([
    db.select({ eventType: globalStatsTable.eventType, cnt: count() })
      .from(globalStatsTable)
      .where(eq(globalStatsTable.date, today))
      .groupBy(globalStatsTable.eventType),
    db.select({ cnt: count() }).from(globalStatsTable),
    db.select({ cnt: count() }).from(globalStatsTable)
      .where(gte(globalStatsTable.date, weekAgo)),
  ]);

  const todayMap: Record<string, number> = {};
  for (const r of todayRows) todayMap[r.eventType] = Number(r.cnt);

  res.json({
    today: {
      tawbah: (todayMap["tawbah"] ?? 0) + (todayMap["covenant"] ?? 0),
      dhikr: todayMap["dhikr"] ?? 0,
      dua: todayMap["dua"] ?? 0,
      quran: todayMap["quran"] ?? 0,
    },
    total: Number(totalRows[0]?.cnt ?? 0),
    thisWeek: Number(weekRows[0]?.cnt ?? 0),
  });
});

// ── Country Map Endpoints ────────────────────────────────────────────

router.post("/stats/pin", async (req, res) => {
  const { countryCode } = req.body as { countryCode: string };
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    res.status(400).json({ error: "كود دولة غير صحيح" });
    return;
  }
  await db.insert(globalStatsTable).values({ eventType: "tawbah", date: todayStr(), countryCode });
  res.json({ ok: true });
});

router.get("/stats/countries", async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const rows = await db
    .select({ countryCode: globalStatsTable.countryCode, cnt: count() })
    .from(globalStatsTable)
    .where(and(gte(globalStatsTable.date, weekAgo), sql`${globalStatsTable.countryCode} IS NOT NULL`))
    .groupBy(globalStatsTable.countryCode)
    .orderBy(sql`count(*) DESC`)
    .limit(20);
  res.json(rows.map(r => ({ countryCode: r.countryCode, count: Number(r.cnt) })));
});

// ── Challenge Endpoints ──────────────────────────────────────────────

function makeSlug(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

router.post("/challenges", async (req, res) => {
  const { duration, pledge } = req.body as { duration: number; pledge?: string };
  if (!duration || ![7, 21, 40, 90].includes(Number(duration))) {
    res.status(400).json({ error: "مدة غير صحيحة" });
    return;
  }
  let slug = makeSlug();
  for (let i = 0; i < 5; i++) {
    const existing = await db.select({ id: challengesTable.id }).from(challengesTable).where(eq(challengesTable.slug, slug));
    if (existing.length === 0) break;
    slug = makeSlug();
  }
  const [row] = await db.insert(challengesTable).values({
    slug,
    duration: Number(duration),
    pledge: pledge?.trim() || null,
    startDate: todayStr(),
  }).returning();
  await db.insert(globalStatsTable).values({ eventType: "tawbah", date: todayStr() });
  res.json({ slug: row.slug });
});

router.get("/challenges/:slug", async (req, res) => {
  const { slug } = req.params;
  const [row] = await db.select().from(challengesTable).where(eq(challengesTable.slug, slug));
  if (!row) { res.status(404).json({ error: "التحدي غير موجود" }); return; }
  const start = new Date(row.startDate);
  const daysPassed = Math.floor((Date.now() - start.getTime()) / 86400000);
  res.json({
    slug: row.slug,
    duration: row.duration,
    pledge: row.pledge,
    startDate: row.startDate,
    daysPassed: Math.min(daysPassed, row.duration),
    encouragements: row.encouragements,
  });
});

router.post("/challenges/:slug/encourage", async (req, res) => {
  const { slug } = req.params;
  const [row] = await db.select({ id: challengesTable.id }).from(challengesTable).where(eq(challengesTable.slug, slug));
  if (!row) { res.status(404).json({ error: "التحدي غير موجود" }); return; }
  await db.update(challengesTable)
    .set({ encouragements: sql`${challengesTable.encouragements} + 1` })
    .where(eq(challengesTable.id, row.id));
  await db.insert(globalStatsTable).values({ eventType: "dua", date: todayStr() });
  res.json({ ok: true });
});

router.post("/secret-dua", async (req, res) => {
  const { sessionId, content } = req.body as { sessionId: string; content: string };
  if (!sessionId || !content?.trim()) {
    res.status(400).json({ error: "sessionId و content مطلوبان" });
    return;
  }

  const recentSessions = await db
    .select({ sessionId: userProgressTable.sessionId })
    .from(userProgressTable)
    .where(ne(userProgressTable.sessionId, sessionId))
    .orderBy(sql`RANDOM()`)
    .limit(10);

  const alreadyReceiving = await db
    .select({ toSessionId: secretDuasTable.toSessionId })
    .from(secretDuasTable)
    .where(and(
      gte(secretDuasTable.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
      ne(secretDuasTable.fromSessionId, sessionId)
    ));

  const alreadyReceivingSet = new Set(alreadyReceiving.map(r => r.toSessionId));

  const candidate = recentSessions.find(s => !alreadyReceivingSet.has(s.sessionId));
  const toSessionId = candidate?.sessionId ?? null;

  await db.insert(secretDuasTable).values({
    fromSessionId: sessionId,
    toSessionId,
    content: content.trim(),
  });

  await db.insert(globalStatsTable).values({ eventType: "dua", date: todayStr() });
  res.json({ ok: true, matched: !!toSessionId });
});

router.get("/secret-dua/received", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) { res.status(400).json({ error: "sessionId مطلوب" }); return; }

  const [dua] = await db
    .select({ id: secretDuasTable.id, content: secretDuasTable.content, createdAt: secretDuasTable.createdAt })
    .from(secretDuasTable)
    .where(and(
      eq(secretDuasTable.toSessionId, sessionId),
      eq(secretDuasTable.isRead, false)
    ))
    .orderBy(desc(secretDuasTable.createdAt))
    .limit(1);

  if (!dua) { res.json({ dua: null }); return; }

  await db.update(secretDuasTable).set({ isRead: true }).where(eq(secretDuasTable.id, dua.id));
  res.json({ dua: { content: dua.content, createdAt: dua.createdAt } });
});

router.get("/secret-dua/stats", async (_req, res) => {
  const [result] = await db.select({ total: count() }).from(secretDuasTable);
  res.json({ total: result?.total ?? 0 });
});

// ══════════════════════════════════════════
// COMMUNITY DUAS — "قل آمين"
// ══════════════════════════════════════════

router.post("/community-duas", async (req, res) => {
  const { sessionId, content } = req.body as { sessionId: string; content: string };
  if (!sessionId || !content?.trim()) {
    res.status(400).json({ error: "sessionId و content مطلوبان" });
    return;
  }
  if (content.trim().length > 300) {
    res.status(400).json({ error: "الدعاء يجب ألا يتجاوز ٣٠٠ حرف" });
    return;
  }
  const [inserted] = await db
    .insert(communityDuasTable)
    .values({ sessionId, content: content.trim() })
    .returning();
  res.json({ dua: inserted });
});

router.get("/community-duas", async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "20"), 50);
  const rows = await db
    .select({
      id: communityDuasTable.id,
      content: communityDuasTable.content,
      amenCount: communityDuasTable.amenCount,
      createdAt: communityDuasTable.createdAt,
    })
    .from(communityDuasTable)
    .orderBy(desc(communityDuasTable.createdAt))
    .limit(limit);
  res.json({ duas: rows });
});

router.post("/community-duas/:id/amen", async (req, res) => {
  const id = parseInt(req.params.id ?? "0");
  if (!id) { res.status(400).json({ error: "id غير صحيح" }); return; }
  const [updated] = await db
    .update(communityDuasTable)
    .set({ amenCount: sql`${communityDuasTable.amenCount} + 1` })
    .where(eq(communityDuasTable.id, id))
    .returning({ amenCount: communityDuasTable.amenCount });
  if (!updated) { res.status(404).json({ error: "الدعاء غير موجود" }); return; }
  res.json({ amenCount: updated.amenCount });
});

// ══════════════════════════════════════════
// AI SIN DETECTION
// ══════════════════════════════════════════

router.post("/detect-sins", async (req, res) => {
  try {
    const { description, audioBase64, sinsLookup } = req.body as {
      description?: string;
      audioBase64?: string;
      sinsLookup: Array<{ id: string; name: string; category: string; description: string }>;
    };

    if (!sinsLookup?.length) {
      res.status(400).json({ error: "sinsLookup is required" });
      return;
    }

    let userText = description?.trim() ?? "";

    // Transcribe audio if provided
    if (audioBase64 && !userText) {
      const rawBuffer = Buffer.from(audioBase64, "base64");
      const { buffer, format } = await ensureCompatibleFormat(rawBuffer);
      const transcript = await speechToText(buffer, format);
      if (!transcript?.trim()) {
        res.status(400).json({ error: "تعذّر فهم التسجيل الصوتي" });
        return;
      }
      userText = transcript.trim();
    }

    if (!userText) {
      res.status(400).json({ error: "description or audioBase64 is required" });
      return;
    }

    const sinListText = sinsLookup
      .map(s => `- id: "${s.id}" | الاسم: ${s.name} | التصنيف: ${s.category} | الوصف: ${s.description}`)
      .join("\n");

    const systemPrompt = `أنت مساعد إسلامي متخصص في تصنيف الذنوب وتحديد أنواعها من وصف المستخدم.
مهمتك: تحليل وصف المستخدم واستخلاص الذنوب التي وقع فيها من القائمة المحددة فقط.

قائمة الذنوب المتاحة:
${sinListText}

تعليمات مهمة:
- استخرج فقط الذنوب الواردة في القائمة أعلاه — لا تخترع ذنوباً غير موجودة
- إذا لم يتطابق الوصف مع أي ذنب، أعد قائمة فارغة
- يمكن أن يتطابق الوصف مع ذنب أو أكثر
- أجب بـ JSON فقط بلا أي نص إضافي

الشكل المطلوب:
{
  "matchedIds": ["id1", "id2"],
  "transcription": "نص ما قاله المستخدم بعد التنقية",
  "explanation": "جملة قصيرة جداً تصف ما فهمته من الوصف"
}`;

    const raw = await generateText({
      maxTokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    });

    let parsed: { matchedIds?: string[]; transcription?: string; explanation?: string } = {};
    try { parsed = JSON.parse(raw); } catch {}

    const validIds = new Set(sinsLookup.map(s => s.id));
    const matchedIds = (parsed.matchedIds ?? []).filter(id => validIds.has(id));

    res.json({
      matchedIds,
      transcription: parsed.transcription ?? userText,
      explanation: parsed.explanation ?? "",
    });
  } catch {
    console.error("Detect sins request failed");
    res.status(500).json({ error: "فشل في تحليل الوصف" });
  }
});

// ── Notification Settings ────────────────────────────────────────────────────

router.get("/notifications/settings", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });
  const row = await db.query.notificationSettingsTable.findFirst({
    where: eq(notificationSettingsTable.sessionId, sessionId),
  });
  res.json(row ?? null);
});

router.put("/notifications/settings", async (req, res) => {
  const { sessionId, settingsJson, prayerCity, prayerCountry, prayerLat, prayerLng } = req.body as {
    sessionId: string; settingsJson: string;
    prayerCity?: string; prayerCountry?: string; prayerLat?: string; prayerLng?: string;
  };
  if (!sessionId || !settingsJson) return void res.status(400).json({ error: "sessionId and settingsJson required" });
  await db.insert(notificationSettingsTable)
    .values({ sessionId, settingsJson, prayerCity, prayerCountry, prayerLat, prayerLng })
    .onConflictDoUpdate({
      target: notificationSettingsTable.sessionId,
      set: { settingsJson, prayerCity, prayerCountry, prayerLat, prayerLng, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

// ── App Inbox ─────────────────────────────────────────────────────────────────

router.get("/notifications/inbox", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });
  const rows = await db.query.appInboxTable.findMany({
    where: eq(appInboxTable.sessionId, sessionId),
    orderBy: [desc(appInboxTable.createdAt)],
    limit: 60,
  });
  res.json(rows);
});

router.post("/notifications/inbox", async (req, res) => {
  const { sessionId, notifId, type, title, body, icon, color } = req.body as {
    sessionId: string; notifId: string; type: string;
    title: string; body: string; icon?: string; color?: string;
  };
  if (!sessionId || !notifId || !title || !body) return void res.status(400).json({ error: "missing fields" });
  const existing = await db.query.appInboxTable.findFirst({
    where: eq(appInboxTable.notifId, notifId),
  });
  if (existing) return void res.json(existing);
  const [row] = await db.insert(appInboxTable)
    .values({ sessionId, notifId, type: type || "reminder", title, body, icon: icon || "bell", color: color || "#4A90B8", isRead: false })
    .returning();
  res.json(row);
});

router.patch("/notifications/inbox/:notifId/read", async (req, res) => {
  const notifId = req.params.notifId;
  await db.update(appInboxTable).set({ isRead: true }).where(eq(appInboxTable.notifId, notifId));
  res.json({ ok: true });
});

router.post("/notifications/inbox/read-all", async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });
  await db.update(appInboxTable).set({ isRead: true }).where(eq(appInboxTable.sessionId, sessionId));
  res.json({ ok: true });
});

router.delete("/notifications/inbox/:notifId", async (req, res) => {
  const notifId = req.params.notifId;
  await db.delete(appInboxTable).where(eq(appInboxTable.notifId, notifId));
  res.json({ ok: true });
});

export default router;
