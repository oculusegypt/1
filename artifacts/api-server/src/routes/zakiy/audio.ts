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
 * Audio synthesis runs on the client through the device/browser speech engine.
 * Paid voice APIs are not available on the connected free-tier account.
 */
export async function generateZakiyAudio(_text: string, _voiceProfileId?: string): Promise<string> {
  return "";
}
