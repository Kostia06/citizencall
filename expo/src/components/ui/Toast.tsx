import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';

interface ToastProps {
  message: string | null;
  onDismiss(): void;
  durationMs?: number;
}

/** Minimal ephemeral banner — command-screen gap fix: mic errors ("no
 * speech detected", permission denied, transcription failed) previously had
 * nowhere to surface on native (the web bar's onToast has no RN sink). No
 * queue; the latest message replaces whatever's showing, auto-dismisses. */
export function Toast({ message, onDismiss, durationMs = 2600 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;
  return (
    <Text style={styles.toast} maxFontSizeMultiplier={1.4}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  toast: {
    ...typography.label,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});
