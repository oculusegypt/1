import type { ServerResponseSegment } from "./types.js";
import { stripFatwaMarkers, stripStageDirections, generateZakiyAudio } from "./audio.js";

export const SURAH_NAMES_AR: Record<number, string> = {
  1:"الفاتحة",2:"البقرة",3:"آل عمران",4:"النساء",5:"المائدة",6:"الأنعام",
  7:"الأعراف",8:"الأنفال",9:"التوبة",10:"يونس",11:"هود",12:"يوسف",
  13:"الرعد",14:"إبراهيم",15:"الحجر",16:"النحل",17:"الإسراء",18:"الكهف",
  19:"مريم",20:"طه",21:"الأنبياء",22:"الحج",23:"المؤمنون",24:"النور",
  25:"الفرقان",26:"الشعراء",27:"النمل",28:"القصص",29:"العنكبوت",30:"الروم",
  31:"لقمان",32:"السجدة",33:"الأحزاب",34:"سبأ",35:"فاطر",36:"يس",
  37:"الصافات",38:"ص",39:"الزمر",40:"غافر",41:"فصلت",42:"الشورى",
  43:"الزخرف",44:"الدخان",45:"الجاثية",46:"الأحقاف",47:"محمد",48:"الفتح",
  49:"الحجرات",50:"ق",51:"الذاريات",52:"الطور",53:"النجم",54:"القمر",
  55:"الرحمن",56:"الواقعة",57:"الحديد",58:"المجادلة",59:"الحشر",60:"الممتحنة",
  61:"الصف",62:"الجمعة",63:"المنافقون",64:"التغابن",65:"الطلاق",66:"التحريم",
  67:"الملك",68:"القلم",69:"الحاقة",70:"المعارج",71:"نوح",72:"الجن",
  73:"المزمل",74:"المدثر",75:"القيامة",76:"الإنسان",77:"المرسلات",78:"النبأ",
  79:"النازعات",80:"عبس",81:"التكوير",82:"الانفطار",83:"المطففين",84:"الانشقاق",
  85:"البروج",86:"الطارق",87:"الأعلى",88:"الغاشية",89:"الفجر",90:"البلد",
  91:"الشمس",92:"الليل",93:"الضحى",94:"الشرح",95:"التين",96:"العلق",
  97:"القدر",98:"البينة",99:"الزلزلة",100:"العاديات",101:"القارعة",102:"التكاثر",
  103:"العصر",104:"الهمزة",105:"الفيل",106:"قريش",107:"الماعون",108:"الكوثر",
  109:"الكافرون",110:"النصر",111:"المسد",112:"الإخلاص",113:"الفلق",114:"الناس",
};

/**
 * Pre-processes AI response text to convert informal Quran citation patterns
 * into proper {{quran:S:A|text}} markers.
 */
export function preprocessQuranCitations(text: string): string {
  const arabicToWestern = (s: string) =>
    s.replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  const nameToNum: Record<string, number> = {};
  for (const [num, name] of Object.entries(SURAH_NAMES_AR)) {
    nameToNum[name] = Number(num);
  }

  return text.replace(
    /سورة\s+([^\s—–\-\n]+)\s*[—–\-]\s*آية\s+([\d٠-٩]+)\s*\n?\s*﴿([^﴾]+)﴾/g,
    (_, surahName, ayahRaw, ayahText) => {
      const surahNum = nameToNum[surahName.trim()];
      const ayahNum = parseInt(arabicToWestern(ayahRaw.trim()));
      if (!surahNum || isNaN(ayahNum)) return `﴿${ayahText}﴾`;
      return `{{quran:${surahNum}:${ayahNum}|${ayahText.trim()}}}`;
    }
  );
}

export function parseRawSegments(raw: string): ServerResponseSegment[] {
  const segments: ServerResponseSegment[] = [];
  const re = /\{\{quran:(\d+):(\d+)(?:-(\d+))?\|([^}]*)\}\}|\{\{fatwa:([^|]*)\|([^|]*)\|([^}]*)\}\}|\{\{promise:([^}]+)\}\}|\{\{surah-link:(\d+):(\d+)\|([^}]*)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const isBareLabel = (t: string) =>
    /^[١٢٣٤٥٦٧٨٩٠\d]+[.\-\)‌]?\s*$/.test(t);

  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      const t = raw.slice(last, m.index).trim();
      if (t && !isBareLabel(t)) segments.push({ type: "text", text: t });
    }
    if (m[1] !== undefined) {
      const surah = Number(m[1]);
      const startAyah = Number(m[2]);
      const endAyah = m[3] !== undefined ? Number(m[3]) : startAyah;
      const fullText = m[4]!;
      if (endAyah > startAyah) {
        const parts = fullText.split(/\s*۝\s*/);
        for (let a = startAyah; a <= endAyah; a++) {
          const idx = a - startAyah;
          const ayahText = parts[idx]?.trim() ?? fullText.trim();
          segments.push({ type: "quran", surah, ayah: a, text: ayahText });
        }
      } else {
        segments.push({ type: "quran", surah, ayah: startAyah, text: fullText });
      }
    } else if (m[5] !== undefined) {
      segments.push({ type: "fatwa", source: m[5]!, url: m[6]!, text: m[7]! });
    } else if (m[8] !== undefined) {
      segments.push({ type: "promise", text: m[8]!.trim() });
    } else if (m[9] !== undefined) {
      const surahNum = Number(m[9]);
      const startAyah = Number(m[10]);
      const surahName = m[11] ?? "";
      segments.push({
        type: "surah-link",
        surah: surahNum,
        ayah: startAyah,
        text: surahName,
        url: `https://quran.com/${surahNum}/${startAyah}`,
      });
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    const t = raw.slice(last).trim();
    if (t && !isBareLabel(t)) segments.push({ type: "text", text: t });
  }
  return segments.length ? segments : [{ type: "text", text: raw }];
}

export async function expandSurahMarkers(raw: string): Promise<string> {
  const re = /\{\{full-surah:(\d+)\}\}/g;
  const matches = Array.from(raw.matchAll(re));
  if (!matches.length) return raw;

  let result = raw;
  for (const match of matches) {
    const surahNum = Number(match[1]);
    try {
      const apiRes = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/quran-uthmani`);
      if (!apiRes.ok) continue;
      const data = await apiRes.json() as { data?: { numberOfAyahs: number; ayahs: { numberInSurah: number; text: string }[] } };
      const ayahs = data.data?.ayahs ?? [];
      const total = data.data?.numberOfAyahs ?? ayahs.length;
      const limit = 20;
      const display = ayahs.slice(0, limit);
      const surahName = SURAH_NAMES_AR[surahNum] ?? `سورة ${surahNum}`;

      let expanded = display.map((a) => `{{quran:${surahNum}:${a.numberInSurah}|${a.text}}}`).join("\n");
      if (total > limit) {
        expanded += `\n{{surah-link:${surahNum}:${limit}|${surahName}}}`;
      }
      result = result.replace(match[0], expanded);
    } catch { /* skip if API fails */ }
  }
  return result;
}

export async function generateSegmentedAudio(responseText: string, voiceProfileId?: string): Promise<ServerResponseSegment[]> {
  const preprocessed = preprocessQuranCitations(responseText);
  const expanded = await expandSurahMarkers(preprocessed);
  const segments = parseRawSegments(expanded);

  const textIndices: number[] = [];
  segments.forEach((seg, i) => {
    if (seg.type === "text") textIndices.push(i);
  });

  const audioResults = await Promise.all(
    textIndices.map(async (segIdx) => {
      const seg = segments[segIdx]!;
      const cleanText = stripStageDirections(stripFatwaMarkers(seg.text));
      if (!cleanText.trim()) return { segIdx, audio: "" };
      try {
        const audio = await generateZakiyAudio(seg.text, voiceProfileId);
        return { segIdx, audio };
      } catch {
        console.error(`[Zakiy TTS] Audio generation failed for segment ${segIdx}`);
        return { segIdx, audio: "" };
      }
    })
  );

  audioResults.forEach(({ segIdx, audio }) => {
    segments[segIdx]!.audioBase64 = audio;
  });

  return segments;
}
