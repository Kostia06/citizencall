import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';

// Mirrors ui/src/components/CommandBar.tsx's SUGGESTIONS — shown only when
// the bar is empty and focused.
export const SUGGESTIONS = [
  "Summarize this week's repository changes and draft a PR description.",
  'List open pull requests assigned to me and classify their risk.',
  'Extract action items from unread emails from the last 3 days.',
];

interface SuggestionListProps {
  onPick(text: string): void;
}

/** Tap FILLS the input rather than running it — the same fill-don't-run
 * behavior as the web bar's click handler (SPEC.md keyboard flows §6). A
 * second tap on the bar's send button is what actually runs it. */
export function SuggestionList({ onPick }: SuggestionListProps) {
  return (
    <View style={styles.wrap}>
      {SUGGESTIONS.map((s) => (
        <Pressable
          key={s}
          onPress={() => onPick(s)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {s}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  rowPressed: { backgroundColor: colors.accentGlow },
  text: { ...typography.label, color: colors.textSecondary },
});
