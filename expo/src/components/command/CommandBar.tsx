// Native port of ui/src/components/CommandBar.tsx — same contracts
// (suggest() ghost, canned SUGGESTIONS, mic → transcript), adapted for
// iOS-idiomatic input instead of keyboard shortcuts (⌘K/Tab/Esc have no
// native meaning here). Owns its own input state so the mic can hand back a
// transcript without the screen re-plumbing controlled-input state; only
// the final text (+ source) is handed up on submit.
import { useRef, useState } from 'react';
import { LayoutAnimation, Platform, PixelRatio, Pressable, StyleSheet, Text, TextInput, UIManager, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';
import { clampInputHeight } from '../../lib/autoGrow';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { MicButton } from './MicButton';
import { SuggestionList } from './SuggestionList';
import { useNextAction } from './useNextAction';
import { Toast } from '../ui/Toast';
import type { AuthedFetch } from '../../api/storeClient';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FONT_SIZE = 15; // matches typography.body / DESIGN.md's body token
const LINE_HEIGHT_RATIO = 1.5; // matches DESIGN.md's leading-[1.5]
const BLUR_TINT = Platform.OS === 'ios' ? 'systemThinMaterialDark' : 'dark';

export interface CommandBarProps {
  running: boolean;
  suggestionsEnabled: boolean;
  /** Last few user prompts, most recent last — the suggest() context. */
  recentPrompts: string[];
  authedFetch: AuthedFetch;
  onSubmit(text: string, opts: { source: 'text' | 'voice' }): void;
}

export function CommandBar({ running, suggestionsEnabled, recentPrompts, authedFetch, onSubmit }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'text' | 'voice'>('text');
  const [focused, setFocused] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const reducedMotion = useReducedMotion();

  const { nextAction, dismiss: dismissGhost } = useNextAction({
    enabled: suggestionsEnabled,
    running,
    focused,
    value,
    recentPrompts,
    authedFetch,
  });

  const fontScale = PixelRatio.getFontScale();
  const lineHeight = FONT_SIZE * LINE_HEIGHT_RATIO * fontScale;
  const height = clampInputHeight(contentHeight, lineHeight, lineHeight);

  // Only shown while empty+focused — a context-aware next ACTION/starter
  // prompt, not a completion of whatever's been typed.
  const showSuggestions = focused && !running && value.trim().length === 0;
  const canSubmit = value.trim().length > 0 && !running;

  function fillValue(text: string) {
    setValue(text);
    setSource('text');
    inputRef.current?.focus();
  }

  function acceptGhost() {
    if (!nextAction) return;
    fillValue(nextAction);
    dismissGhost();
  }

  function handleSubmit() {
    const text = value.trim();
    if (!text || running) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onSubmit(text, { source });
    // Chat now — the prompt reappears as its own bubble in the transcript,
    // so the bar clears and is immediately ready for the next turn.
    setValue('');
    setSource('text');
  }

  function handleContentSizeChange(nextHeight: number) {
    // Smooths the pill's height reflow as lines wrap/unwrap — the RN
    // analogue of the web bar's CSS height transition. Skipped under Reduce
    // Motion per DESIGN.md §3's `layout-flow` reduced-motion fallback
    // (instant reflow, no animated height).
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setContentHeight(nextHeight);
  }

  return (
    <View>
      <Toast message={toast} onDismiss={() => setToast(null)} />

      <BlurView intensity={40} tint={BLUR_TINT} style={styles.pill}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(text) => {
            setValue(text);
            setSource('text');
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={nextAction ?? 'Ask Understudy to do something...'}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { height }]}
          multiline
          editable={!running}
          // iOS-idiomatic choice: Return always inserts a newline (matches
          // ChatGPT/Claude's prompt inputs, not Messages' send-on-return) —
          // this is a multi-line command, not a chat bubble, so a stray
          // Return shouldn't fire a run. Submission is only ever the send
          // button below; there's no soft-keyboard "Shift" for a
          // send-on-return pattern to fall back to on iOS.
          returnKeyType="default"
          blurOnSubmit={false}
          onContentSizeChange={(e) => handleContentSizeChange(e.nativeEvent.contentSize.height)}
          maxFontSizeMultiplier={1.6}
          accessibilityLabel="Command"
        />

        <View style={styles.trailingRow}>
          {nextAction ? (
            <Pressable
              onPress={acceptGhost}
              style={styles.useChip}
              accessibilityRole="button"
              accessibilityLabel="Use suggested next action"
            >
              <Text style={styles.useChipText} maxFontSizeMultiplier={1.3}>
                Use
              </Text>
            </Pressable>
          ) : null}

          <MicButton
            disabled={running}
            onFinal={(text) => {
              setSource('voice');
              setValue(text);
            }}
            onToast={setToast}
          />

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.submit, canSubmit ? styles.submitActive : styles.submitInactive]}
          >
            <View style={styles.submitArrow} />
          </Pressable>
        </View>
      </BlurView>

      {showSuggestions ? <SuggestionList onPick={fillValue} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: FONT_SIZE, paddingTop: 0, paddingBottom: 0 },
  trailingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  useChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  useChipText: { ...typography.caption, textTransform: 'none', letterSpacing: 0, color: colors.accentBright },
  submit: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  submitActive: { backgroundColor: colors.accent },
  submitInactive: { backgroundColor: colors.surfaceRaised },
  submitArrow: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.void,
    transform: [{ rotate: '-45deg' }],
    marginLeft: -2,
  },
});
