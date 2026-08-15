import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/typography';

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 140;

interface CommandInputProps {
  value: string;
  onChangeText(text: string): void;
  onSubmit(): void;
  disabled?: boolean;
}

/** Centered auto-growing input — the command bar's mobile equivalent
 * (DESIGN.md's pill, adapted to a full-width dock instead of a floating
 * bar since there's no cursor-reactive background to anchor it to here). */
export function CommandInput({ value, onChangeText, onSubmit, disabled }: CommandInputProps) {
  const [contentHeight, setContentHeight] = useState(MIN_HEIGHT);
  const canSubmit = value.trim().length > 0 && !disabled;

  return (
    <View style={styles.pill}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Ask Understudy to do something..."
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, { height: Math.min(Math.max(MIN_HEIGHT, contentHeight), MAX_HEIGHT) }]}
        multiline
        editable={!disabled}
        onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
      />
      <Pressable
        onPress={() => {
          if (!canSubmit) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          onSubmit();
        }}
        disabled={!canSubmit}
        style={[styles.submit, canSubmit ? styles.submitActive : styles.submitInactive]}
      >
        <View style={styles.submitArrow} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingTop: 0, paddingBottom: 0 },
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
