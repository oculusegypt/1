import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { VOICE_PROFILES, DEFAULT_VOICE_PROFILE } from "./prompts.js";

export function stripQuranMarkers(text: string): string {
  return text
    .replace(/\{\{quran:\d+:\d+(?:-\d+)?\|[^}]*\}\}/g, "")
    .replace(/﴿[^﴾]*﴾/g, "")
    .replace(/سورة\s+\S+\s*[—–\-]\s*آية\s+[\d٠-٩]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripFatwaMarkers(text: string): string {
  return text.replace(/\{\{fatwa:[^|]*\|[^|]*\|([^}]*)\}\}/g, "").replace(/\s{2,}/g, " ").trim();
}

export function stripStageDirections(text: string): string {
  return text
    .replace(/\[[^\]]{1,80}\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripForTTS(text: string): string {
  return stripFatwaMarkers(stripQuranMarkers(text))
    .replace(/\[[^\]]{1,60}\]/g, "")
    .replace(/\(\s*ب[^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripEmojisAndSymbols(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[═─━╔╗╚╝║〔〕]/g, "")
    .replace(/[۝﴿﴾]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Generate TTS audio for a text segment using OpenAI's audio model.
 * Returns base64-encoded WAV audio string, or "" on failure.
 */
export async function generateZakiyAudio(text: string, voiceProfileId?: string): Promise<string> {
  const profileId = voiceProfileId ?? DEFAULT_VOICE_PROFILE;
  const profile = VOICE_PROFILES[profileId] ?? VOICE_PROFILES[DEFAULT_VOICE_PROFILE]!;

  const cleanText = stripEmojisAndSymbols(stripStageDirections(stripForTTS(text)));
  if (!cleanText.trim()) return "";

  try {
    const audioBuffer = await textToSpeech(
      `${profile.system}\n\n${cleanText}`,
      profile.voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      "wav"
    );
    return audioBuffer.toString("base64");
  } catch {
    console.error("[Zakiy TTS] Audio generation failed");
    return "";
  }
}
