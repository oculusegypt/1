import { Router, type IRouter } from "express";
import { generateText } from "../lib/ai-providers.js";

const router: IRouter = Router();

// ── Islamic date helpers ──────────────────────────────────────────────────────

function getHijriDate(date: Date) {
  const MONTHS = [
    "محرم","صفر","ربيع الأول","ربيع الثاني",
    "جمادى الأولى","جمادى الآخرة","رجب","شعبان",
    "رمضان","شوال","ذو القعدة","ذو الحجة",
  ];
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    day: "numeric", month: "numeric", year: "numeric", timeZone: "Africa/Cairo",
  }).formatToParts(date);
  let day = 1, month = 9, year = 1447;
  for (const p of parts) {
    if (p.type === "day")   day   = parseInt(p.value);
    if (p.type === "month") month = parseInt(p.value);
    if (p.type === "year")  year  = parseInt(p.value);
  }
  return { day, month, monthName: MONTHS[month - 1] ?? "رمضان", year };
}

function getTimePeriodLabel(hour: number): string {
  if (hour < 4)  return "ما قبل الفجر — وقت التهجد والقيام";
  if (hour < 6)  return "وقت الفجر — أول النهار";
  if (hour < 8)  return "وقت الإشراق — بعد الشروق";
  if (hour < 12) return "وقت الضحى";
  if (hour < 13) return "وقت الظهر";
  if (hour < 16) return "وقت العصر";
  if (hour < 19) return "وقت المغرب";
  return "وقت العشاء والليل";
}

function getOccasionNote(month: number, day: number): string {
  if (month === 9) {
    if (day <= 10) return `رمضان المبارك — العشر الأولى (أيام الرحمة) — اليوم ${day}`;
    if (day <= 20) return `رمضان المبارك — العشر الأوسط (أيام المغفرة) — اليوم ${day}`;
    return `رمضان المبارك — العشر الأواخر (أيام العتق) — اليوم ${day}`;
  }
  if (month === 10 && day === 1) return "عيد الفطر المبارك";
  if (month === 10 && day <= 6) return `أيام شوال — صيام الست (اليوم ${day})`;
  if (month === 12 && day <= 9) return `العشر الأوائل من ذو الحجة — اليوم ${day}`;
  if (month === 12 && day === 9) return "يوم عرفة — أعظم أيام السنة";
  if (month === 12 && day === 10) return "عيد الأضحى المبارك";
  if (month === 1 && day === 10) return "يوم عاشوراء المبارك";
  return "";
}

function getDayFadhail(date: Date): string {
  const day = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "Africa/Cairo" });
  if (day === "Friday") return "اليوم جمعة — خير يوم طلعت عليه الشمس";
  if (day === "Monday" || day === "Thursday") return `اليوم ${day === "Monday" ? "الاثنين" : "الخميس"} — تُعرض فيه الأعمال على الله`;
  return "";
}

// ── In-memory cache (keyed by hour + hijri date) ─────────────────────────────

interface CacheEntry {
  key: string;
  data: HeroContentItem[];
  expiresAt: number;
}

interface HeroContentItem {
  type: "ayah" | "hadith" | "dhikr" | "nafl" | "dua" | "wisdom";
  text: string;
  source?: string;
}

let cache: CacheEntry | null = null;

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/hero-content", async (req, res) => {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false, timeZone: "Africa/Cairo" })
  );
  const hijri = getHijriDate(now);
  const cacheKey = `${hour}-${hijri.month}-${hijri.day}`;

  if (cache && cache.key === cacheKey && Date.now() < cache.expiresAt) {
    return res.json({ items: cache.data });
  }

  const timePeriod = getTimePeriodLabel(hour);
  const occasion   = getOccasionNote(hijri.month, hijri.day);
  const dayFadhail = getDayFadhail(now);

  const systemPrompt = `أنت "الزكي" — المرشد الإسلامي الذكي الحكيم.
مهمتك الآن: توليد محتوى روحاني متنوع يُعرَض في واجهة التطبيق للمستخدم.

السياق الحالي:
- الوقت: ${timePeriod}
- التاريخ الهجري: ${hijri.day} ${hijri.monthName} ${hijri.year}هـ
${occasion ? `- المناسبة: ${occasion}` : ""}
${dayFadhail ? `- فضيلة اليوم: ${dayFadhail}` : ""}

المطلوب: أعد JSON array بالضبط بـ 5 عناصر متنوعة، كل عنصر:
{
  "type": "ayah" | "hadith" | "dhikr" | "nafl" | "dua" | "wisdom",
  "text": "النص",
  "source": "المصدر (اختياري)"
}

قواعد صارمة:
- الآيات: من القرآن الكريم فقط، أحط النص بـ ﴿ ﴾، اذكر السورة والآية في source
- الأحاديث: من صحيح البخاري أو مسلم أو الترمذي فقط، بين القوسين «»، اذكر المصدر
- الأذكار: أذكار صحيحة مأثورة مناسبة للوقت الحالي
- النوافل: تذكير بنافلة أو سنة مناسبة للوقت الحالي تحديداً
- الدعاء والحكمة: مأثورة صحيحة
- التنوع إلزامي: لا تكرر نفس النوع
- راعِ الوقت والمناسبة تماماً في كل عنصر
- أعد JSON فقط، بدون أي نص إضافي`;

  try {
    const raw = await generateText({
      maxTokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "أعد المحتوى الآن." },
      ],
    });

    let items: HeroContentItem[] = [];
    try {
      const parsed = JSON.parse(raw) as { items?: HeroContentItem[] } | HeroContentItem[];
      items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
    } catch {
      items = [];
    }

    if (!items.length) {
      return res.json({ items: getFallback(hour) });
    }

    cache = { key: cacheKey, data: items, expiresAt: Date.now() + 30 * 60 * 1000 };
    return res.json({ items });
  } catch {
    return res.json({ items: getFallback(hour) });
  }
});

function getFallback(hour: number): HeroContentItem[] {
  const items: HeroContentItem[] = [
    { type: "ayah",    text: "﴿قُلْ يَا عِبَادِيَ الَّذِينَ أَسْرَفُوا عَلَى أَنفُسِهِمْ لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ﴾", source: "الزمر: 53" },
    { type: "hadith",  text: "«التائبُ من الذنبِ كمَن لا ذنبَ له»", source: "رواه ابن ماجه" },
    { type: "dhikr",   text: "سبحان الله وبحمده، سبحان الله العظيم", source: "أذكار الصباح" },
    { type: "wisdom",  text: "كلما ازداد إحساسك بالذنب ازداد دليلاً على يقظة قلبك — فلا تيأس، بل تُب وأقبِل." },
  ];
  if (hour < 8)
    items.push({ type: "nafl", text: "ركعتا الفجر خيرٌ من الدنيا وما فيها — لا تفوّتهما.", source: "رواه مسلم" });
  else if (hour < 12)
    items.push({ type: "nafl", text: "صلاة الضحى — من ركعتين إلى ١٢ ركعة. الآن أفضل وقتها.", source: "رواه الترمذي" });
  else
    items.push({ type: "dua", text: "«اللهم إني أسألك علمًا نافعًا ورزقًا طيبًا وعملًا متقبَّلًا»", source: "دعاء الصباح" });
  return items;
}

export default router;
