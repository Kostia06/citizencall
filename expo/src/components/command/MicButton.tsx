import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { transcribeAudio } from '../../api/sttClient';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/typography';

type Phase = 'idle' | 'recording' | 'transcribing';

interface MicButtonProps {
  disabled?: boolean;
  onFinal(text: string): void;
  onToast(message: string): void;
}

/** Voice input — records via expo-audio, posts the clip to `/api/stt`
 * (sttClient, MOCK-aware), and hands the transcript up as final text (no
 * live interim streaming on native — the web's Web Speech API `onInterim`
 * has no RN equivalent, so this only fires once transcription lands).
 * Idle → recording and recording → transcribing both tick a distinct
 * haptic, matching CommandBar's submit tick so every state change on the
 * bar has a consistent physical confirmation (DESIGN.md §5 Mic). */
export function MicButton({ disabled, onFinal, onToast }: MicButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  async function start() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onToast('Microphone permission denied');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recorder.record();
      setPhase('recording');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    } catch {
      onToast('Microphone unavailable');
      setPhase('idle');
    }
  }

  async function stop() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setPhase('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        onToast('No audio captured');
        return;
      }
      const text = await transcribeAudio({ uri, mimeType: 'audio/m4a' });
      if (text) onFinal(text);
      else onToast('No speech detected');
    } catch {
      onToast('Transcription failed — type instead');
    } finally {
      setPhase('idle');
    }
  }

  const recording = phase === 'recording';
  const transcribing = phase === 'transcribing';

  return (
    <View style={styles.wrap}>
      {recording ? <View style={styles.breathe} /> : null}
      <Pressable
        disabled={disabled || transcribing}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording' : transcribing ? 'Transcribing' : 'Start voice input'}
        onPress={() => (recording ? stop() : start())}
        style={[styles.button, (disabled || transcribing) && styles.disabled]}
      >
        {transcribing ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : recording ? (
          <View style={styles.dot} />
        ) : (
          // Dependency-free "voice" glyph (three bars) — same box-drawing
          // approach as TabsLayout's Dot and CommandInput's submit arrow,
          // no icon font/emoji.
          <View style={styles.bars}>
            <View style={[styles.bar, styles.barShort]} />
            <View style={[styles.bar, styles.barTall]} />
            <View style={[styles.bar, styles.barMid]} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  button: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  breathe: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    opacity: 0.2,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 16 },
  bar: { width: 3, borderRadius: 1.5, backgroundColor: colors.textSecondary },
  barShort: { height: 8 },
  barMid: { height: 12 },
  barTall: { height: 16 },
});
