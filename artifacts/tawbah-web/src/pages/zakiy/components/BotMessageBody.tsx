import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Pause, Volume2, Loader2, Heart, CheckSquare } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { aiUrl } from "@/lib/api-base";
import type { Message, ApiHistory } from "../types";
import { FormattedText } from "./FormattedText";
import { QuranCard } from "./QuranCard";
import { FatwaCard } from "./FatwaCard";
import { PromiseCard } from "./PromiseCard";
import { SurahLinkCard } from "./SurahLinkCard";
import { ImpressionPanel } from "./ImpressionPanel";

interface Props {
  msg: Message;
  onImpressionToggle: (id: string, text?: string) => void;
  impressionOpen: boolean;
  impressionText?: string;
  sessionId: string;
  history: ApiHistory[];
  isAutoPlayTarget: boolean;
  onAudioComplete: () => void;
}

export function BotMessageBody({
  msg, onImpressionToggle, impressionOpen, impressionText, sessionId, history, isAutoPlayTarget, onAudioComplete,
}: Props) {
  const { autoPlayBotAudio, autoPlayQuran, quranReciterId } = useSettings();

  const [playIdx, setPlayIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const autoStartedRef = useRef(false);
  const textAudioRefs = useRef<Record<number, HTMLAudioElement>>({});
  const nativeSpeechRef = useRef<{ index: number; utterance: SpeechSynthesisUtterance } | null>(null);
  const segments = msg.segments ?? [];

  const advanceTo = useCallback((nextIdx: number) => {
    const seg = segments[nextIdx];
    if (!seg) {
      setPlayIdx(-1);
      setIsPlaying(false);
      onAudioComplete();
      return;
    }
    if (seg.type === "fatwa" || seg.type === "promise" || seg.type === "surah-link") {
      advanceTo(nextIdx + 1); return;
    }
    setPlayIdx(nextIdx);
    setIsPlaying(true);
  }, [segments, onAudioComplete]);

  useEffect(() => {
    if (!isAutoPlayTarget || autoStartedRef.current) return;
    const hasSpeakableText = segments.some(
      s => s.type === "text" && (Boolean(s.audioBase64) || Boolean(s.text.trim()))
    );
    const hasQuran = segments.some(s => s.type === "quran");
    const shouldStart = (autoPlayBotAudio && hasSpeakableText) || (autoPlayQuran && hasQuran);
    if (!shouldStart) {
      onAudioComplete();
      return;
    }
    autoStartedRef.current = true;
    const t = setTimeout(() => advanceTo(0), 400);
    return () => clearTimeout(t);
  }, [isAutoPlayTarget, autoPlayBotAudio, autoPlayQuran, segments]);

  const handleSegmentEnd = useCallback((idx: number) => {
    advanceTo(idx + 1);
  }, [advanceTo]);

  useEffect(() => {
    if (playIdx === -1) {
      if (nativeSpeechRef.current && typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
        nativeSpeechRef.current = null;
      }
      return;
    }

    const seg = segments[playIdx];
    if (!seg || seg.type !== "text") {
      if (nativeSpeechRef.current && typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
        nativeSpeechRef.current = null;
      }
      return;
    }

    if (!seg.audioBase64) {
      const speechSynthesis = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
        if (isPlaying) handleSegmentEnd(playIdx);
        return;
      }

      const activeSpeech = nativeSpeechRef.current;
      if (!isPlaying) {
        if (activeSpeech?.index === playIdx) speechSynthesis.pause();
        return;
      }
      if (activeSpeech?.index === playIdx) {
        if (speechSynthesis.paused) speechSynthesis.resume();
        return;
      }

      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(seg.text);
      utterance.lang = "ar-EG";
      const arabicVoice = speechSynthesis.getVoices().find(voice =>
        voice.lang.toLowerCase().startsWith("ar")
      );
      if (arabicVoice) utterance.voice = arabicVoice;

      nativeSpeechRef.current = { index: playIdx, utterance };
      const finishSpeech = () => {
        if (nativeSpeechRef.current?.utterance !== utterance) return;
        nativeSpeechRef.current = null;
        handleSegmentEnd(playIdx);
      };
      utterance.onend = finishSpeech;
      utterance.onerror = finishSpeech;
      speechSynthesis.speak(utterance);
      return;
    }

    if (!isPlaying) return;

    if (nativeSpeechRef.current && typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
      nativeSpeechRef.current = null;
    }

    let audio = textAudioRefs.current[playIdx];
    if (!audio) {
      const binary = atob(seg.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      const mimeType = isWav ? "audio/wav" : "audio/mpeg";
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      audio = new Audio(url);
      textAudioRefs.current[playIdx] = audio;
    }

    audio.onended = () => { handleSegmentEnd(playIdx); };
    audio.play().catch((e: unknown) => {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setIsPlaying(false);
      } else {
        handleSegmentEnd(playIdx);
      }
    });

    return () => { audio?.pause(); };
  }, [playIdx, isPlaying, handleSegmentEnd]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  function handlePlayToggle() {
    if (segments.length === 0) return;
    if (playIdx !== -1 && isPlaying) {
      if (segments[playIdx]?.type === "text") {
        if (segments[playIdx]?.audioBase64) {
          textAudioRefs.current[playIdx]?.pause();
        } else {
          window.speechSynthesis?.pause();
        }
      }
      setIsPlaying(false);
    } else if (playIdx !== -1 && !isPlaying) {
      if (segments[playIdx]?.type === "text") {
        if (segments[playIdx]?.audioBase64) {
          textAudioRefs.current[playIdx]?.play().catch(() => {});
        } else {
          window.speechSynthesis?.resume();
        }
      }
      setIsPlaying(true);
    } else {
      advanceTo(0);
    }
  }

  const hasAudio = segments.some(
    s => s.type === "text" && (Boolean(s.audioBase64) || Boolean(s.text.trim()))
  );
  const isCurrentlyPlaying = playIdx !== -1 && isPlaying;

  const [hadiLoading, setHadiLoading] = useState(false);
  const [hadiDone, setHadiDone] = useState(false);
  const [, navigate] = useLocation();

  const hasSteps = (() => {
    const fullText = segments.map(s => s.text).join("\n");
    return /[\u0661-\u0669][\.\-\)]|^[1-9][\.\-\)]/m.test(fullText) || /^[\u0661-\u0669][\.\-\)]/m.test(fullText);
  })();

  async function handleHadiTasks() {
    setHadiLoading(true);
    try {
      const fullText = segments.map(s => s.text).join("\n").slice(0, 2000);
      const res = await fetch(aiUrl("/api/hadi-tasks/extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل الاستخراج");
      setHadiDone(true);
      setTimeout(() => navigate("/hadi-tasks"), 600);
    } catch {
      setHadiDone(false);
    } finally {
      setHadiLoading(false);
    }
  }

  const [impressionLoading, setImpressionLoading] = useState(false);

  async function handleImpressionClick() {
    if (impressionOpen) { onImpressionToggle(msg.id); return; }
    if (impressionText) { onImpressionToggle(msg.id, impressionText); return; }
    setImpressionLoading(true);
    try {
      const res = await fetch(aiUrl("/api/zakiy/impression"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, sessionId }),
      });
      const data = await res.json();
      onImpressionToggle(msg.id, data.impression ?? "لسه بتعرف بعضنا — كمّل الحديث وهشوفك أكتر!");
    } catch {
      onImpressionToggle(msg.id, "مش قدرت أوصلك الانطباع دلوقتي — جرّب تاني بعد شوية.");
    } finally {
      setImpressionLoading(false);
    }
  }

  if (!segments.length) {
    return <FormattedText text={msg.text} />;
  }

  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === "quran") {
          return (
            <QuranCard
              key={i}
              seg={seg}
              isActive={playIdx === i}
              isPlaying={playIdx === i && isPlaying}
              onEnded={() => handleSegmentEnd(i)}
              reciterId={quranReciterId}
              onManualToggle={() => {
                if (playIdx === i && isPlaying) {
                  setIsPlaying(false);
                } else {
                  setPlayIdx(i);
                  setIsPlaying(true);
                }
              }}
            />
          );
        }
        if (seg.type === "fatwa") return <FatwaCard key={i} seg={seg} />;
        if (seg.type === "promise") return <PromiseCard key={i} seg={seg} sessionId={sessionId} />;
        if (seg.type === "surah-link") return <SurahLinkCard key={i} seg={seg} />;
        return (
          <FormattedText
            key={i}
            text={seg.text}
            isActivePlaying={playIdx === i && isPlaying}
          />
        );
      })}

      <div className="flex items-center gap-2 mt-3.5 flex-wrap">
        {hasAudio && (
          <button
            type="button"
            onClick={handlePlayToggle}
            aria-label={isCurrentlyPlaying ? "إيقاف صوت الرد" : "تشغيل صوت الرد"}
            data-testid={`zakiy-speech-${msg.id}`}
            className="flex items-center gap-1.5 text-[11.5px] font-bold px-3.5 py-1.5 rounded-full transition-all active:scale-95"
            style={isCurrentlyPlaying
              ? { background: "linear-gradient(135deg,#0d9488,#059669)", color: "#fff", boxShadow: "0 2px 8px rgba(5,150,105,0.3)" }
              : { background: "rgba(5,150,105,0.08)", color: "#047857", border: "1.5px solid rgba(5,150,105,0.2)" }
            }
          >
            {isCurrentlyPlaying ? <><Pause size={11} strokeWidth={2.5} /> إيقاف</> : <><Volume2 size={11} strokeWidth={2} /> استمع</>}
          </button>
        )}

        {msg.id !== "greeting" && (
          <button
            onClick={handleImpressionClick}
            disabled={impressionLoading}
            className="flex items-center gap-1.5 text-[11.5px] font-bold px-3.5 py-1.5 rounded-full transition-all active:scale-95"
            style={impressionOpen
              ? { background: "linear-gradient(135deg,#be123c,#e11d48)", color: "#fff", boxShadow: "0 2px 8px rgba(225,29,72,0.3)" }
              : { background: "rgba(225,29,72,0.07)", color: "#be123c", border: "1.5px solid rgba(225,29,72,0.2)" }
            }
          >
            {impressionLoading
              ? <><Loader2 size={11} className="animate-spin" /> لحظة...</>
              : <><Heart size={11} strokeWidth={2} className={impressionOpen ? "fill-white" : ""} /> انطباعي</>
            }
          </button>
        )}

        {msg.id !== "greeting" && hasSteps && (
          <button
            onClick={handleHadiTasks}
            disabled={hadiLoading || hadiDone}
            className="flex items-center gap-1.5 text-[11.5px] font-bold px-3.5 py-1.5 rounded-full transition-all active:scale-95"
            style={hadiDone
              ? { background: "linear-gradient(135deg,#059669,#0d9488)", color: "#fff" }
              : { background: "rgba(5,150,105,0.07)", color: "#065f46", border: "1.5px solid rgba(5,150,105,0.18)" }
            }
          >
            {hadiLoading
              ? <><Loader2 size={11} className="animate-spin" /> جاري...</>
              : hadiDone
                ? <><CheckSquare size={11} strokeWidth={2.5} /> تمت الإضافة!</>
                : <><CheckSquare size={11} strokeWidth={2} /> مهام هادي</>
            }
          </button>
        )}
      </div>

      <AnimatePresence>
        {impressionOpen && impressionText && (
          <ImpressionPanel impression={impressionText} onClose={() => onImpressionToggle(msg.id)} />
        )}
      </AnimatePresence>
    </div>
  );
}
