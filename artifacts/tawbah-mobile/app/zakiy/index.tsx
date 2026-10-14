import { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView,
  Platform, I18nManager, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeIn, FadeInDown, FadeInUp, useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useRouter } from "expo-router";
import {
  ChevronRight, Send, Mic, MicOff, Settings2, AlertTriangle, X, Sparkles, Volume2, Pause,
} from "lucide-react-native";
import { useSettings } from "@/providers/SettingsProvider";
import { useColors } from "@/hooks/useColors";
import { useZakiy } from "@/engines/zakiy/useZakiy";
import type { Message } from "@/engines/zakiy/types";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
}

function getSpeakableText(msg: Message): string {
  const speechSegments = msg.segments?.filter(
    (segment) => segment.type === "text" || segment.type === "quran"
  );
  const source = speechSegments?.length
    ? speechSegments.map((segment) => segment.text).join(" ")
    : msg.text;

  return source
    .replace(/\{\{(?:quran|fatwa|promise|surah-link):[^}]*\}\}/g, " ")
    .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function MessageBubble({
  msg,
  isDark,
  c,
}: {
  msg: Message;
  isDark: boolean;
  c: ReturnType<typeof useColors>;
}) {
  const isUser = msg.role === "user";
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechText = isUser ? "" : getSpeakableText(msg);

  useEffect(() => {
    if (!isSpeaking) return;
    return () => { void Speech.stop(); };
  }, [isSpeaking]);

  const toggleSpeech = useCallback(async () => {
    if (!speechText) return;
    try {
      await Speech.stop();
      if (isSpeaking) {
        setIsSpeaking(false);
        return;
      }
      setIsSpeaking(true);
      Speech.speak(speechText, {
        language: "ar-EG",
        rate: 0.96,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    } catch {
      setIsSpeaking(false);
    }
  }, [isSpeaking, speechText]);

  return (
    <Animated.View
      entering={FadeInDown.duration(280).springify()}
      style={{
        flexDirection: "row",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 8,
      }}
    >
      <View
        style={{
          maxWidth: "85%",
          borderRadius: 20,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: isUser
            ? c.primary
            : isDark ? c.cardBento1 : c.surface,
          borderWidth: isUser ? 0 : 1,
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 2,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            lineHeight: 22,
            color: isUser ? "#ffffff" : c.text,
            fontFamily: "IBMPlexSansArabic_400Regular",
            textAlign: "right",
          }}
        >
          {msg.text}
        </Text>

        {!isUser && speechText ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? "إيقاف صوت الرد" : "تشغيل صوت الرد"}
            testID={`zakiy-speech-${msg.id}`}
            onPress={() => { void toggleSpeech(); }}
            style={({ pressed }) => ({
              alignSelf: "flex-end",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 40,
              minHeight: 40,
              padding: 8,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            {isSpeaking
              ? <Pause size={17} color={c.primary} />
              : <Volume2 size={17} color={c.textMuted} />}
          </Pressable>
        ) : null}

        {msg.suggestions && msg.suggestions.length > 0 && (
          <View style={{ marginTop: 10, gap: 6 }}>
            {msg.suggestions.map((s, i) => (
              <Pressable
                key={i}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 12,
                  backgroundColor: isDark ? "rgba(5,150,105,0.18)" : "rgba(5,150,105,0.1)",
                  borderWidth: 1,
                  borderColor: "rgba(5,150,105,0.3)",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: "#059669",
                    fontFamily: "IBMPlexSansArabic_500Medium",
                    textAlign: "right",
                  }}
                >
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {msg.suggestionsLoading && (
          <ActivityIndicator
            size="small"
            color="#059669"
            style={{ marginTop: 8, alignSelf: "flex-end" }}
          />
        )}

        <Text
          style={{
            fontSize: 10,
            color: isUser ? "rgba(255,255,255,0.6)" : c.textMuted,
            textAlign: "right",
            marginTop: 6,
            fontFamily: "IBMPlexSansArabic_400Regular",
          }}
        >
          {formatTime(msg.timestamp)}
        </Text>
      </View>
    </Animated.View>
  );
}

function ThinkingIndicator({ isDark, c }: { isDark: boolean; c: ReturnType<typeof useColors> }) {
  const dot1 = useSharedValue(0.4);
  const dot2 = useSharedValue(0.4);
  const dot3 = useSharedValue(0.4);

  useEffect(() => {
    dot1.value = withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.4, { duration: 400 })), -1, false);
    setTimeout(() => {
      dot2.value = withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.4, { duration: 400 })), -1, false);
    }, 133);
    setTimeout(() => {
      dot3.value = withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.4, { duration: 400 })), -1, false);
    }, 266);
  }, []);

  const d1Style = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const d2Style = useAnimatedStyle(() => ({ opacity: dot2.value }));
  const d3Style = useAnimatedStyle(() => ({ opacity: dot3.value }));

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 18,
        backgroundColor: isDark ? "#1a2e1a" : "#ffffff",
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
        alignSelf: "flex-start",
        marginBottom: 8,
      }}
    >
      <Text style={{ fontSize: 12, color: c.textMuted, fontFamily: "IBMPlexSansArabic_400Regular" }}>الزكي بيفكر</Text>
      <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
        {[d1Style, d2Style, d3Style].map((style, i) => (
          <Animated.View
            key={i}
            style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#059669" }, style]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

export default function ZakiyScreen() {
  const router = useRouter();
  const c = useColors();
  const { resolvedTheme } = useSettings();
  const isDark = resolvedTheme === "dark";
  const scrollRef = useRef<ScrollView>(null);

  const {
    messages,
    input,
    setInput,
    chatState,
    isBusy,
    recording,
    riskAlert,
    anniversaryMilestone,
    voiceProfileId,
    voiceSelectorOpen,
    setVoiceSelectorOpen,
    currentVoiceProfile,
    starters,
    hasUserMessages,
    sendMessage,
    startVoiceRecording,
    stopVoiceRecording,
    handleVoiceProfileSelect,
    dismissRiskAlert,
    VOICE_PROFILES,
  } = useZakiy();

  const micScale = useSharedValue(1);
  const micAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: micScale.value }] }));

  useEffect(() => {
    if (recording) {
      micScale.value = withRepeat(
        withSequence(withTiming(1.15, { duration: 600 }), withTiming(0.9, { duration: 600 })),
        -1,
        true
      );
    } else {
      micScale.value = withSpring(1, { damping: 20 });
    }
  }, [recording]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(input);
  }, [input, isBusy, sendMessage]);

  const handleStarterPress = useCallback((question: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(question);
  }, [sendMessage]);

  const handleVoicePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (recording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  }, [recording, startVoiceRecording, stopVoiceRecording]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? "#030d03" : "#f0fdf4" }} edges={["top"]}>
      <View style={{ flex: 1 }}>

        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
            backgroundColor: isDark ? "rgba(3,13,3,0.96)" : "rgba(240,253,244,0.97)",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 38, height: 38, borderRadius: 12,
              alignItems: "center", justifyContent: "center",
              backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
            }}
          >
            <ChevronRight size={20} color={c.textMuted} />
          </Pressable>

          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {anniversaryMilestone && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(251,191,36,0.15)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1, borderColor: "rgba(251,191,36,0.3)" }}>
                  <Sparkles size={11} color="#f59e0b" />
                  <Text style={{ fontSize: 10, color: "#f59e0b", fontFamily: "IBMPlexSansArabic_700Bold" }}>{anniversaryMilestone}</Text>
                </View>
              )}
              <Text style={{ fontSize: 16, fontWeight: "900", color: c.text, fontFamily: "IBMPlexSansArabic_700Bold" }}>الزكي</Text>
            </View>
            <Text style={{ fontSize: 11, color: c.textMuted, fontFamily: "IBMPlexSansArabic_400Regular" }}>صاحبك الروحاني دايماً معاك</Text>
          </View>

          <Pressable
            onPress={() => setVoiceSelectorOpen(!voiceSelectorOpen)}
            style={{
              width: 38, height: 38, borderRadius: 12,
              alignItems: "center", justifyContent: "center",
              backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
            }}
          >
            <Settings2 size={18} color={c.textMuted} />
          </Pressable>
        </View>

        {voiceSelectorOpen && (
          <Animated.View
            entering={FadeInDown.duration(200)}
            style={{
              marginHorizontal: 12,
              marginTop: 4,
              borderRadius: 16,
              backgroundColor: isDark ? "#111a11" : "#ffffff",
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)",
              padding: 8,
              zIndex: 50,
              position: "absolute",
              top: 60,
              left: 12,
              right: 12,
              shadowColor: "#000",
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            {VOICE_PROFILES.map((vp) => (
              <Pressable
                key={vp.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  handleVoiceProfileSelect(vp.id);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor:
                    voiceProfileId === vp.id
                      ? "rgba(5,150,105,0.12)"
                      : "transparent",
                  justifyContent: "flex-end",
                }}
              >
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: voiceProfileId === vp.id ? "#059669" : c.text, fontFamily: "IBMPlexSansArabic_700Bold" }}>
                    {vp.name}
                  </Text>
                  <Text style={{ fontSize: 11, color: c.textMuted, fontFamily: "IBMPlexSansArabic_400Regular" }}>
                    {vp.tag}
                  </Text>
                </View>
                <Text style={{ fontSize: 20 }}>{vp.emoji}</Text>
              </Pressable>
            ))}
          </Animated.View>
        )}

        {riskAlert && (
          <Animated.View
            entering={FadeInUp.duration(300)}
            style={{
              marginHorizontal: 12,
              marginTop: 8,
              borderRadius: 14,
              padding: 12,
              backgroundColor: riskAlert.level === "high"
                ? "rgba(220,38,38,0.1)"
                : "rgba(245,158,11,0.1)",
              borderWidth: 1,
              borderColor: riskAlert.level === "high"
                ? "rgba(220,38,38,0.3)"
                : "rgba(245,158,11,0.3)",
              flexDirection: "row",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <Pressable onPress={dismissRiskAlert} style={{ padding: 2 }}>
              <X size={14} color={c.textMuted} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text style={{ fontSize: 12, fontWeight: "800", color: riskAlert.level === "high" ? "#dc2626" : "#d97706", fontFamily: "IBMPlexSansArabic_700Bold", marginBottom: 2 }}>
                {riskAlert.level === "high" ? "⚠️ الزكي قلقان عليك" : "💛 الزكي يلاحظ"}
              </Text>
              <Text style={{ fontSize: 12, color: riskAlert.level === "high" ? "#dc2626" : "#d97706", fontFamily: "IBMPlexSansArabic_400Regular", lineHeight: 18, textAlign: "right" }}>
                {riskAlert.message}
              </Text>
              {riskAlert.sign && (
                <Text style={{ fontSize: 10, color: c.textMuted, marginTop: 4, textAlign: "right" }}>
                  العلامة: {riskAlert.sign}
                </Text>
              )}
            </View>
            <AlertTriangle
              size={16}
              color={riskAlert.level === "high" ? "#dc2626" : "#d97706"}
            />
          </Animated.View>
        )}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 16,
            paddingBottom: 16,
            backgroundColor: isDark ? "rgba(3,13,3,0.4)" : "rgba(240,253,244,0.5)",
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {!hasUserMessages && starters.length > 0 && (
            <Animated.View entering={FadeIn.duration(400)} style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: c.textMuted, textAlign: "center", marginBottom: 12, fontFamily: "IBMPlexSansArabic_400Regular" }}>
                اختار موضوع أو اكتب سؤالك
              </Text>
              <View style={{ gap: 8 }}>
                {starters.map((s, i) => (
                  <Animated.View key={i} entering={FadeInDown.delay(i * 60).springify()}>
                    <Pressable
                      onPress={() => handleStarterPress(s.q)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        borderRadius: 18,
                        backgroundColor: isDark ? "#111a11" : "#ffffff",
                        borderWidth: 1,
                        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                        justifyContent: "flex-end",
                        shadowColor: "#000",
                        shadowOpacity: 0.06,
                        shadowRadius: 8,
                        elevation: 1,
                      })}
                    >
                      <Text style={{ fontSize: 14, color: c.text, fontFamily: "IBMPlexSansArabic_500Medium", flex: 1, textAlign: "right" }}>
                        {s.q}
                      </Text>
                      <Text style={{ fontSize: 18 }}>{s.icon}</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} isDark={isDark} c={c} />
          ))}

          {(chatState === "thinking" || chatState === "responding") && (
            <ThinkingIndicator isDark={isDark} c={c} />
          )}
        </ScrollView>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              paddingBottom: Platform.OS === "ios" ? 14 : 10,
              borderTopWidth: 1,
              borderTopColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
              backgroundColor: isDark ? "#030d03" : "#f0fdf4",
            }}
          >
            <Pressable
              onPress={handleSend}
              disabled={!input.trim() || isBusy}
              style={{
                width: 44, height: 44, borderRadius: 14,
                alignItems: "center", justifyContent: "center",
                backgroundColor: input.trim() && !isBusy ? "#059669" : (isDark ? "#1a2e1a" : "#e5e7eb"),
                opacity: input.trim() && !isBusy ? 1 : 0.5,
              }}
            >
              <Send size={18} color={input.trim() && !isBusy ? "#fff" : c.textMuted} />
            </Pressable>

            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="اسأل الزكي..."
              placeholderTextColor={c.textMuted}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                borderRadius: 18,
                paddingHorizontal: 16,
                paddingVertical: 11,
                fontSize: 14,
                color: c.text,
                backgroundColor: isDark ? "#111a11" : "#ffffff",
                textAlign: "right",
                fontFamily: "IBMPlexSansArabic_400Regular",
                maxHeight: 100,
              }}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              multiline
              textAlignVertical="center"
            />

            <Animated.View style={micAnimStyle}>
              <Pressable
                onPress={handleVoicePress}
                style={{
                  width: 44, height: 44, borderRadius: 14,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: recording
                    ? "#dc2626"
                    : (isDark ? "#1a2e1a" : "#e5e7eb"),
                  borderWidth: recording ? 2 : 0,
                  borderColor: recording ? "rgba(220,38,38,0.4)" : "transparent",
                }}
              >
                {recording
                  ? <MicOff size={18} color="#fff" />
                  : <Mic size={18} color={c.text} />
                }
              </Pressable>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}
