import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions, Platform, ScrollView, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  ArrowRight,
  BookOpen,
  BookText,
  Eye,
  EyeOff,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  X,
  Bookmark,
  BookmarkCheck,
} from "lucide-react-native";
import { useAyahs, Ayah } from "@/hooks/useQuranData";
import { useQuranAudio } from "@/hooks/useQuranAudio";
import { useSettings } from "@/providers/SettingsProvider";
import { QuranAudioPlayer } from "@/components/quran/QuranAudioPlayer";
import { saveBookmark, removeBookmark, getBookmarks } from "./bookmarks";

const PAGE_SIZE = 10;
const SHEET_MAX_HEIGHT = Math.min(620, Math.round(Dimensions.get("window").height * 0.78));
const SHEET_MIN_HEIGHT = 160;

const QURAN_RECITERS = [
  { id: "ar.alafasy", nameAr: "مشاري العفاسي" },
  { id: "ar.abdulbasit", nameAr: "عبد الباسط" },
  { id: "ar.husary", nameAr: "محمود الحصري" },
  { id: "ar.ghamadi", nameAr: "سعد الغامدي" },
  { id: "ar.hanirifai", nameAr: "هاني الرفاعي" },
  { id: "ar.abdulsamad", nameAr: "عبد الصمد" },
];

const SURAH_NAMES: Record<number, string> = {
  1:"الفاتحة",2:"البقرة",3:"آل عمران",4:"النساء",5:"المائدة",6:"الأنعام",
  7:"الأعراف",8:"الأنفال",9:"التوبة",10:"يونس",11:"هود",12:"يوسف",
  13:"الرعد",14:"ابراهيم",15:"الحجر",16:"النحل",17:"الإسراء",18:"الكهف",
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

export default function QuranReadScreen() {
  const router = useRouter();
  const { surah } = useLocalSearchParams<{ surah?: string }>();
  const surahNumber = parseInt(surah || "1", 10);

  const { resolvedTheme } = useSettings();
  const isDark = resolvedTheme === "dark";

  const { ayahs, loading, error } = useAyahs(surahNumber);
  const audio = useQuranAudio();

  // refs
  const tafsirCacheRef = useRef(new Map<string, { ar: string; en: string }>());
  const tajweedCacheRef = useRef(new Map<number, string>());
  const ayahsRef = useRef<Ayah[]>([]);
  const playAyahFnRef = useRef<((ayah: Ayah) => void) | null>(null);

  // shared values for tafsir sheet
  const sheetOpen = useSharedValue(0);
  const sheetDragY = useSharedValue(0);
  const sheetHeight = useSharedValue(SHEET_MIN_HEIGHT);

  useEffect(() => {
    ayahsRef.current = ayahs;
  }, [ayahs]);

  const palette = useMemo(() => ({
    bg: isDark ? "#062e2a" : "#f8fafc",
    card: isDark ? "#052e25" : "#ffffff",
    card2: isDark ? "#022c22" : "#f1f5f9",
    border: isDark ? "#0b3b2f" : "#e2e8f0",
    text: isDark ? "#ecfdf5" : "#0f172a",
    muted: isDark ? "#a7f3d0" : "#64748b",
    gold: "#fbbf24",
    emerald: isDark ? "#22c55e" : "#064e3b",
    danger: "#ef4444",
    primary: isDark ? "#059669" : "#1a4731",
  }), [isDark]);

  // animated styles
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetOpen.value, [0, 1], [0, 1]),
  }));
  const sheetStyle = useAnimatedStyle(() => {
    const h = sheetHeight.value;
    const translateY = Math.max(0, SHEET_MAX_HEIGHT - h) + sheetDragY.value;
    return { height: h, transform: [{ translateY }] };
  });

  // state
  const [currentPage, setCurrentPage] = useState(0);
  const [fontSize, setFontSize] = useState(24);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showTafsir, setShowTafsir] = useState(false);
  const [selectedAyah, setSelectedAyah] = useState<Ayah | null>(null);
  const [tafsirAr, setTafsirAr] = useState("");
  const [tafsirEn, setTafsirEn] = useState("");
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState<string | null>(null);
  const [hifzMode, setHifzMode] = useState(false);
  const [hiddenAyahs, setHiddenAyahs] = useState<Set<number>>(new Set());
  const [reciterId, setReciterId] = useState("ar.alafasy");
  const [showReciterPicker, setShowReciterPicker] = useState(false);
  const [bookmarkedAyahs, setBookmarkedAyahs] = useState<Set<number>>(new Set());

  // Load bookmarks state for current surah
  useEffect(() => {
    getBookmarks().then(list => {
      const ids = new Set(list.filter(b => b.surahId === surahNumber).map(b => b.ayahNum));
      setBookmarkedAyahs(ids);
    });
  }, [surahNumber]);

  const toggleAyahBookmark = useCallback(async (ayah: Ayah) => {
    const isAlready = bookmarkedAyahs.has(ayah.numberInSurah);
    if (isAlready) {
      const list = await getBookmarks();
      const bm = list.find(b => b.surahId === surahNumber && b.ayahNum === ayah.numberInSurah);
      if (bm) await removeBookmark(bm.id);
      setBookmarkedAyahs(prev => { const s = new Set(prev); s.delete(ayah.numberInSurah); return s; });
    } else {
      await saveBookmark({ surahId: surahNumber, surahName: SURAH_NAMES[surahNumber] ?? `سورة ${surahNumber}`, ayahNum: ayah.numberInSurah, ayahText: ayah.text, note: "" });
      setBookmarkedAyahs(prev => new Set([...prev, ayah.numberInSurah]));
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [bookmarkedAyahs, surahNumber]);

  const totalPages = Math.ceil(ayahs.length / PAGE_SIZE);
  const paginatedAyahs = ayahs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const goToPage = useCallback((page: number) => {
    if (page >= 0 && page < totalPages) setCurrentPage(page);
  }, [totalPages]);

  const toggleAyahVisibility = (ayahNumber: number) => {
    setHiddenAyahs(prev => {
      const s = new Set(prev);
      s.has(ayahNumber) ? s.delete(ayahNumber) : s.add(ayahNumber);
      return s;
    });
  };
  const showAllAyahs = () => setHiddenAyahs(new Set());
  const hideAllAyahs = () => setHiddenAyahs(new Set(ayahs.map(a => a.number)));

  const mushafFont = "Amiri_400Regular";
  const tafsirArabicFont = "IBMPlexSansArabic_400Regular";
  const tafsirArabicFontBold = "IBMPlexSansArabic_700Bold";

  // ── Tafsir ──────────────────────────────────────────────────────────────────
  const fetchTafsir = useCallback(async (ayahGlobalNumber: number) => {
    const key = String(ayahGlobalNumber);
    const cached = tafsirCacheRef.current.get(key);
    if (cached) { setTafsirAr(cached.ar); setTafsirEn(cached.en); return; }
    setTafsirLoading(true); setTafsirError(null);
    try {
      const [arRes, enRes] = await Promise.all([
        fetch(`https://api.alquran.cloud/v1/ayah/${ayahGlobalNumber}/ar.muyassar`),
        fetch(`https://api.alquran.cloud/v1/ayah/${ayahGlobalNumber}/en.sahih`),
      ]);
      if (!arRes.ok || !enRes.ok) throw new Error("فشل التحميل");
      const arJson = await arRes.json() as { data?: { text?: string } };
      const enJson = await enRes.json() as { data?: { text?: string } };
      const ar = (arJson.data?.text || "").trim();
      const en = (enJson.data?.text || "").trim();
      tafsirCacheRef.current.set(key, { ar, en });
      setTafsirAr(ar); setTafsirEn(en);
    } catch (e) {
      setTafsirError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setTafsirLoading(false);
    }
  }, []);

  // ── Tajweed ──────────────────────────────────────────────────────────────────
  const fetchTajweed = useCallback(async () => {
    if (tajweedCacheRef.current.size) return;
    try {
      const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}/quran-tajweed`);
      if (!res.ok) return;
      const json = await res.json() as { data?: { ayahs?: { numberInSurah: number; text: string }[] } };
      for (const a of json.data?.ayahs || []) {
        if (typeof a.numberInSurah === "number") tajweedCacheRef.current.set(a.numberInSurah, a.text);
      }
    } catch {}
  }, [surahNumber]);

  useEffect(() => { fetchTajweed(); }, [fetchTajweed]);

  type TajweedSpan = { text: string; color?: string };
  const tajweedColors = useMemo(() => ({
    h: "#f59e0b", n: "#22c55e", l: "#22c55e",
    p: "#3b82f6", m: "#ef4444", q: isDark ? "#94a3b8" : "#64748b",
  } as Record<string, string>), [isDark]);

  const parseTajweed = useCallback((input: string): TajweedSpan[] => {
    const spans: TajweedSpan[] = []; let i = 0; let buf = "";
    const flush = () => { if (buf) { spans.push({ text: buf }); buf = ""; } };
    while (i < input.length) {
      const ch = input[i];
      if (ch !== "[") { buf += ch; i++; continue; }
      const j = input.indexOf("[", i + 1); if (j === -1) { buf += ch; i++; continue; }
      const header = input.slice(i + 1, j);
      const k = input.indexOf("]", j + 1); if (k === -1) { buf += ch; i++; continue; }
      const content = input.slice(j + 1, k);
      flush();
      const tag = header.split(":")[0]?.trim();
      spans.push({ text: content, color: tag ? (tajweedColors[tag] || undefined) : undefined });
      i = k + 1;
    }
    flush(); return spans;
  }, [tajweedColors]);

  // ── Tafsir sheet open/close ──────────────────────────────────────────────────
  const openTafsir = useCallback((ayah: Ayah) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setSelectedAyah(ayah); setShowTafsir(true); setTafsirAr(""); setTafsirEn(""); setTafsirError(null);
    sheetHeight.value = withTiming(SHEET_MAX_HEIGHT, { duration: 260, easing: Easing.out(Easing.cubic) });
    sheetOpen.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    fetchTafsir(ayah.number);
  }, [fetchTafsir, sheetHeight, sheetOpen]);

  const closeTafsir = useCallback(() => {
    sheetHeight.value = withTiming(SHEET_MIN_HEIGHT, { duration: 220, easing: Easing.out(Easing.quad) });
    sheetOpen.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) }, (f) => {
      if (f) { runOnJS(setShowTafsir)(false); runOnJS(setSelectedAyah)(null); }
    });
  }, [sheetHeight, sheetOpen]);

  // ── Audio playback ────────────────────────────────────────────────────────────
  // Keep a stable ref to the play function that captures latest deps
  useEffect(() => {
    playAyahFnRef.current = (ayah: Ayah) => {
      const allAyahs = ayahsRef.current;
      const globalIdx = allAyahs.findIndex(a => a.number === ayah.number);
      const audioUrl = `https://cdn.islamic.network/quran/audio/128/${reciterId}/${ayah.number}.mp3`;

      const onFinished = () => {
        const nextAyah = ayahsRef.current[globalIdx + 1];
        if (nextAyah) playAyahFnRef.current?.(nextAyah);
      };

      audio.play(surahNumber, ayah.numberInSurah, audioUrl, onFinished);
      setShowPlayer(true);

      // Auto-navigate pages
      const targetPage = Math.floor(globalIdx / PAGE_SIZE);
      setCurrentPage(targetPage);
    };
  }, [audio, surahNumber, reciterId]);

  const playAyah = useCallback((ayah: Ayah) => {
    playAyahFnRef.current?.(ayah);
  }, []);

  const playSurahFromStart = useCallback(() => {
    if (ayahs.length > 0 && ayahs[0]) {
      playAyahFnRef.current?.(ayahs[0]);
    }
  }, [ayahs]);

  // Next / Prev handlers for the player
  const handleNext = useCallback(() => {
    const idx = ayahsRef.current.findIndex(a => a.numberInSurah === audio.currentAyah);
    const next = ayahsRef.current[idx + 1];
    if (next) playAyahFnRef.current?.(next);
  }, [audio.currentAyah]);

  const handlePrev = useCallback(() => {
    const idx = ayahsRef.current.findIndex(a => a.numberInSurah === audio.currentAyah);
    if (idx > 0) {
      const prev = ayahsRef.current[idx - 1];
      if (prev) playAyahFnRef.current?.(prev);
    }
  }, [audio.currentAyah]);

  const surahName = SURAH_NAMES[surahNumber] || `سورة ${surahNumber}`;
  const currentReciter = QURAN_RECITERS.find(r => r.id === reciterId);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
        <View style={styles.loadingContainer}>
          <BookText size={48} color={palette.muted} />
          <Text style={[styles.loadingText, { color: palette.text, marginTop: 16 }]}>جاري التحميل...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !ayahs.length) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]}>
        <View style={styles.errorContainer}>
          <X size={48} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger, marginTop: 16 }]}>{error || "لا توجد بيانات"}</Text>
          <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: palette.card2, borderColor: palette.border }]}>
            <ArrowRight size={20} color={palette.text} />
            <Text style={[styles.backBtnText, { color: palette.text, marginRight: 8 }]}>رجوع</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const renderAyah = ({ item }: { item: Ayah }) => {
    const isCurrentlyPlaying = audio.isPlaying && audio.currentAyah === item.numberInSurah;
    const tajweedText = tajweedCacheRef.current.get(item.numberInSurah);
    const spans = tajweedText ? parseTajweed(tajweedText) : null;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.ayahContainer,
          { backgroundColor: palette.card, borderColor: palette.border },
          isCurrentlyPlaying && { backgroundColor: isDark ? "#064e3b" : "#ecfdf5", borderColor: palette.gold },
          pressed && styles.pressed,
        ]}
        onPress={() => playAyah(item)}
      >
        <View style={[styles.ayahNumber, { backgroundColor: palette.card2, borderColor: palette.border }]}>
          <Text style={[styles.ayahNumberText, { color: palette.text }]}>{item.numberInSurah}</Text>
        </View>
        <View style={styles.ayahContent}>
          {hifzMode && hiddenAyahs.has(item.number) ? (
            <Pressable onPress={() => toggleAyahVisibility(item.number)} style={styles.hiddenAyah}>
              <EyeOff size={24} color={palette.muted} />
              <Text style={[styles.hiddenText, { color: palette.muted }]}>اضغط لإظهار الآية</Text>
            </Pressable>
          ) : (
            <>
              {spans ? (
                <Text style={[styles.ayahText, { color: palette.text, fontSize, textAlign: "right", fontFamily: mushafFont }]}>
                  {spans.map((s, idx2) => (
                    <Text key={idx2} style={{ color: s.color || palette.text, fontFamily: mushafFont }}>{s.text}</Text>
                  ))}
                </Text>
              ) : (
                <Text style={[styles.ayahText, { color: palette.text, fontSize, textAlign: "right", fontFamily: mushafFont }]}>
                  {item.text}
                </Text>
              )}
              {showTranslation && item.translation ? (
                <Text style={[styles.ayahTranslation, { color: palette.muted, fontSize: fontSize - 8 }]}>
                  {item.translation}
                </Text>
              ) : null}
            </>
          )}
        </View>
        <View style={styles.ayahActions}>
          {hifzMode && (
            <Pressable style={styles.actionBtn} onPress={() => toggleAyahVisibility(item.number)}>
              {hiddenAyahs.has(item.number) ? <EyeOff size={18} color={palette.muted} /> : <Eye size={18} color={palette.muted} />}
            </Pressable>
          )}
          <Pressable style={styles.actionBtn} onPress={() => toggleAyahBookmark(item)}>
            {bookmarkedAyahs.has(item.numberInSurah)
              ? <BookmarkCheck size={18} color={palette.gold} />
              : <Bookmark size={18} color={palette.muted} />}
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => openTafsir(item)}>
            <BookOpen size={18} color={palette.muted} />
          </Pressable>
          <Pressable style={styles.playBtn} onPress={() => playAyah(item)}>
            {isCurrentlyPlaying ? <Pause size={20} color={palette.emerald} /> : <Play size={20} color={palette.emerald} />}
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const sheetGesture = Gesture.Pan()
    .onUpdate((evt) => { sheetDragY.value = evt.translationY; })
    .onEnd((evt) => {
      sheetDragY.value = 0;
      const nextHeight = sheetHeight.value - evt.translationY;
      if (nextHeight < SHEET_MAX_HEIGHT * 0.6 || evt.velocityY > 1200) {
        runOnJS(closeTafsir)();
      } else {
        sheetHeight.value = withSpring(SHEET_MAX_HEIGHT, { damping: 18, stiffness: 180 });
      }
    });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <ArrowRight size={22} color={palette.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: palette.text }]}>{surahName}</Text>
          <Text style={[styles.headerSubtitle, { color: palette.muted }]}>{currentPage + 1} من {totalPages}</Text>
        </View>
        <Pressable onPress={() => setHifzMode(prev => {
          const next = !prev;
          if (next) { setShowTranslation(false); setHiddenAyahs(new Set(ayahs.map(a => a.number))); }
          else { setShowTranslation(true); setHiddenAyahs(new Set()); }
          return next;
        })} style={styles.headerBtn}>
          {hifzMode ? <EyeOff size={22} color={palette.gold} /> : <Eye size={22} color={palette.text} />}
        </Pressable>
        <Pressable onPress={() => { if (audio.isPlaying) setShowPlayer(true); else playSurahFromStart(); }} style={styles.headerBtn}>
          <Music size={22} color={palette.emerald} />
        </Pressable>
      </View>

      {/* Reciter Selector */}
      <View style={[styles.reciterBar, { backgroundColor: palette.card2, borderColor: palette.border }]}>
        <Text style={[styles.reciterLabel, { color: palette.muted }]}>القارئ:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reciterRow}>
          {QURAN_RECITERS.map(r => (
            <Pressable
              key={r.id}
              onPress={() => setReciterId(r.id)}
              style={[
                styles.reciterChip,
                { borderColor: r.id === reciterId ? palette.primary : palette.border },
                r.id === reciterId && { backgroundColor: palette.primary },
              ]}
            >
              <Text style={[styles.reciterChipText, { color: r.id === reciterId ? "#ffffff" : palette.muted }]}>
                {r.nameAr}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Ayah List */}
      <FlatList
        data={paginatedAyahs}
        renderItem={renderAyah}
        keyExtractor={(item) => item.number.toString()}
        contentContainerStyle={styles.ayahList}
        showsVerticalScrollIndicator={false}
      />

      {/* Bottom Controls */}
      <View style={[styles.bottomControls, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.pageControls}>
          <Pressable onPress={() => goToPage(currentPage - 1)} disabled={currentPage === 0}
            style={[styles.pageBtn, currentPage === 0 && styles.disabledBtn]}>
            <Text style={[styles.pageBtnText, { color: palette.text, marginRight: 4 }]}>السابق</Text>
            <ArrowRight size={18} color={palette.text} />
          </Pressable>
          <View style={styles.pageIndicator}>
            <Text style={[styles.pageIndicatorText, { color: palette.muted }]}>{currentPage + 1} / {totalPages}</Text>
          </View>
          <Pressable onPress={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages - 1}
            style={[styles.pageBtn, currentPage >= totalPages - 1 && styles.disabledBtn]}>
            <Text style={[styles.pageBtnText, { color: palette.text, marginLeft: 4 }]}>التالي</Text>
            <ArrowRight size={18} color={palette.text} style={{ transform: [{ scaleX: -1 }] }} />
          </Pressable>
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.fontControls}>
            <Pressable onPress={() => setFontSize(Math.max(18, fontSize - 2))} style={styles.fontBtn}>
              <Minus size={16} color={palette.text} />
            </Pressable>
            <Text style={[styles.fontSizeText, { color: palette.muted }]}>{fontSize}</Text>
            <Pressable onPress={() => setFontSize(Math.min(40, fontSize + 2))} style={styles.fontBtn}>
              <Plus size={16} color={palette.text} />
            </Pressable>
          </View>
          {hifzMode ? (
            <View style={styles.hifzControls}>
              <Pressable onPress={showAllAyahs} style={[styles.hifzBtn, { backgroundColor: palette.card2, borderColor: palette.border }]}>
                <Eye size={16} color={palette.text} />
                <Text style={[styles.hifzBtnText, { color: palette.text }]}>إظهار الكل</Text>
              </Pressable>
              <Pressable onPress={hideAllAyahs} style={[styles.hifzBtn, { backgroundColor: palette.card2, borderColor: palette.border }]}>
                <EyeOff size={16} color={palette.text} />
                <Text style={[styles.hifzBtnText, { color: palette.text }]}>إخفاء الكل</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setShowTranslation(!showTranslation)}
              style={[styles.toggleBtn, { backgroundColor: palette.card2, borderColor: palette.border }]}>
              <BookText size={18} color={palette.text} />
              <Text style={[styles.toggleText, { color: palette.text }]}>
                {showTranslation ? "إخفاء الترجمة" : "إظهار الترجمة"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Audio Player Sheet */}
      <QuranAudioPlayer
        surahName={surahName}
        reciterName={currentReciter?.nameAr}
        visible={showPlayer}
        onClose={() => setShowPlayer(false)}
        audio={audio}
        onNext={handleNext}
        onPrev={handlePrev}
      />

      {/* Tafsir Sheet */}
      {showTafsir && (
        <>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)", zIndex: 10 }, overlayStyle]}
            pointerEvents="box-none"
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeTafsir} />
          </Animated.View>

          <GestureDetector gesture={sheetGesture}>
            <Animated.View
              style={[
                styles.tafsirSheet,
                { backgroundColor: palette.card, borderColor: palette.border },
                sheetStyle,
              ]}
            >
              <View style={styles.sheetHandle} />
              <View style={[styles.sheetHeader, { borderColor: palette.border }]}>
                <Text style={[styles.sheetTitle, { color: palette.text, fontFamily: "IBMPlexSansArabic_700Bold" }]}>
                  التفسير · الآية {selectedAyah?.numberInSurah}
                </Text>
                <Pressable onPress={closeTafsir} style={styles.sheetClose}>
                  <X size={20} color={palette.muted} />
                </Pressable>
              </View>

              <ScrollView style={styles.sheetContent} showsVerticalScrollIndicator={false}>
                {selectedAyah && (
                  <Text style={[styles.ayahTextInSheet, { color: palette.text, fontFamily: mushafFont }]}>
                    {selectedAyah.text} ﴿{selectedAyah.numberInSurah}﴾
                  </Text>
                )}
                {tafsirLoading ? (
                  <Text style={[styles.tafsirLoading, { color: palette.muted, fontFamily: tafsirArabicFont }]}>جاري التحميل...</Text>
                ) : tafsirError ? (
                  <Text style={[styles.tafsirError, { color: palette.danger, fontFamily: tafsirArabicFont }]}>{tafsirError}</Text>
                ) : (
                  <>
                    {tafsirAr ? (
                      <View style={[styles.tafsirBlock, { borderColor: palette.border }]}>
                        <Text style={[styles.tafsirLang, { color: palette.muted, fontFamily: tafsirArabicFontBold }]}>التفسير</Text>
                        <Text style={[styles.tafsirText, { color: palette.text, fontFamily: tafsirArabicFont }]}>{tafsirAr}</Text>
                      </View>
                    ) : null}
                    {tafsirEn ? (
                      <View style={[styles.tafsirBlock, { borderColor: palette.border }]}>
                        <Text style={[styles.tafsirLang, { color: palette.muted, fontFamily: tafsirArabicFontBold }]}>Translation</Text>
                        <Text style={[styles.tafsirText, { color: palette.text, fontFamily: tafsirArabicFont }]}>{tafsirEn}</Text>
                      </View>
                    ) : null}
                  </>
                )}
              </ScrollView>
            </Animated.View>
          </GestureDetector>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, gap: 8 },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "bold", fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" },
  headerSubtitle: { fontSize: 11, marginTop: 1 },
  reciterBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  reciterLabel: { fontSize: 12, fontWeight: "600" },
  reciterRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  reciterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  reciterChipText: { fontSize: 11, fontWeight: "600" },
  ayahList: { padding: 12, paddingBottom: 120 },
  ayahContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6 },
      android: { elevation: 2 },
    }),
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  ayahNumber: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
    marginEnd: 12, marginTop: 4, borderWidth: 1,
  },
  ayahNumberText: { fontSize: 13, fontWeight: "bold" },
  ayahContent: { flex: 1 },
  ayahText: { lineHeight: 44 },
  ayahTranslation: { marginTop: 8, lineHeight: 22 },
  hiddenAyah: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  hiddenText: { fontSize: 13 },
  ayahActions: { flexDirection: "column", alignItems: "center", gap: 8, marginStart: 8 },
  actionBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  playBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  bottomControls: { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 10, paddingBottom: 20 },
  pageControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  pageBtn: { flexDirection: "row", alignItems: "center", padding: 8 },
  disabledBtn: { opacity: 0.35 },
  pageBtnText: { fontSize: 13, fontWeight: "600" },
  pageIndicator: { alignItems: "center" },
  pageIndicatorText: { fontSize: 13 },
  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fontControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  fontBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.05)" },
  fontSizeText: { fontSize: 13, width: 28, textAlign: "center" },
  hifzControls: { flexDirection: "row", gap: 8 },
  hifzBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  hifzBtnText: { fontSize: 12, fontWeight: "600" },
  toggleBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  toggleText: { fontSize: 13, fontWeight: "600" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { fontSize: 14 },
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  errorText: { fontSize: 14, textAlign: "center" },
  backBtn: { flexDirection: "row", alignItems: "center", marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  backBtnText: { fontSize: 14, fontWeight: "600" },
  tafsirSheet: {
    position: "absolute", bottom: 0, start: 0, end: 0,
    borderTopStartRadius: 24, borderTopEndRadius: 24,
    borderWidth: 1, zIndex: 20,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 20 },
      android: { elevation: 20 },
    }),
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.15)", alignSelf: "center", marginTop: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1 },
  sheetTitle: { fontSize: 16, fontWeight: "bold" },
  sheetClose: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  sheetContent: { padding: 16 },
  ayahTextInSheet: { fontSize: 22, lineHeight: 44, textAlign: "right", marginBottom: 16 },
  tafsirBlock: { borderTopWidth: 1, paddingTop: 12, marginBottom: 16 },
  tafsirLang: { fontSize: 11, fontWeight: "700", marginBottom: 6 },
  tafsirText: { fontSize: 15, lineHeight: 26, textAlign: "right" },
  tafsirLoading: { fontSize: 14, textAlign: "center", marginTop: 20 },
  tafsirError: { fontSize: 14, textAlign: "center", marginTop: 20 },
});
