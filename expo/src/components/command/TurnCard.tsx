import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';
import { HopCard } from './HopCard';
import type { Turn } from '../../lib/conversationReducer';

/** One turn of the chat transcript: the user's prompt, then the run's trace
 * rendered as sub-task groups of compact hop cards, ending in a cost/savings
 * summary once `run_end` lands. Mirrors TracePipeline.tsx's structure. */
export function TurnCard({ turn }: { turn: Turn }) {
  const { trace } = turn;

  return (
    <View style={styles.wrap}>
      <View style={styles.promptBubble}>
        <Text style={styles.promptText}>{turn.prompt}</Text>
      </View>

      <View style={styles.responseArea}>
        {trace.status === 'running' && !trace.plan ? (
          <View style={styles.thinkingRow}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.thinking}>planning...</Text>
          </View>
        ) : null}

        {trace.plan?.subTasks.map((subTask) => (
          <View key={subTask.id} style={styles.subTaskGroup}>
            <Text style={styles.subTaskLabel}>
              {subTask.kind} · {subTask.instruction}
            </Text>
            {(trace.rungsBySubTask[subTask.id] ?? []).map((rung, i) => (
              <HopCard key={`${subTask.id}-${i}`} rung={rung} />
            ))}
          </View>
        ))}

        {trace.status === 'error' ? <Text style={styles.error}>{trace.error ?? 'Run failed.'}</Text> : null}

        {trace.runEnd ? (
          <View style={styles.summary}>
            <Text style={styles.summaryCost}>${trace.runEnd.totalCostUsd.toFixed(4)}</Text>
            <Text style={styles.summaryMeta}>
              {trace.runEnd.totalMs}ms · {trace.runEnd.savingsPct.toFixed(0)}% cheaper than baseline
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl, gap: spacing.md },
  promptBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.accent,
    borderRadius: radius.xl,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  promptText: { ...typography.body, color: colors.void },
  responseArea: { gap: spacing.sm },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thinking: { ...typography.label, color: colors.textTertiary },
  subTaskGroup: { gap: spacing.xs },
  subTaskLabel: { ...typography.label, color: colors.textSecondary, textTransform: 'capitalize' },
  error: { ...typography.body, color: colors.danger },
  summary: {
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  summaryCost: { ...typography.headline2, color: colors.textPrimary },
  summaryMeta: { ...typography.label, color: colors.textTertiary },
});
