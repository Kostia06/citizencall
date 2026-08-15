import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';
import type { RungState } from '../../lib/traceReducer';

const VERDICT_LABEL: Record<string, string> = {
  pass: 'passed',
  fail_schema: 'schema failure',
  fail_grounding: 'ungrounded',
  fail_empty: 'empty response',
  fail_tool: 'tool failure',
  fail_cold: 'model cold',
};

/** One rung of the escalation ladder — SPEC.md §15's key beat: a compact
 * card that expands to show the routing reasons, cost, and latency. An
 * escalated rung carries a small "stepped up" tag pointing at what failed. */
export function HopCard({ rung }: { rung: RungState }) {
  const [expanded, setExpanded] = useState(false);
  const { decision, hopStart, hop, escalatedFrom } = rung;

  if (!decision && !escalatedFrom) return null;

  const modelId = hop?.modelId ?? hopStart?.modelId ?? decision?.modelId ?? 'routing...';
  const isFail = hop?.verdict && hop.verdict !== 'pass';
  const isEscalation = (decision?.ladderPosition ?? 0) > 0 || Boolean(escalatedFrom);

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={[styles.card, isFail && styles.cardFail, isEscalation && styles.cardEscalation]}
    >
      <View style={styles.headerRow}>
        <View style={styles.modelInfo}>
          {isEscalation ? <Text style={styles.escalationTag}>ESCALATED</Text> : null}
          <Text style={styles.modelId} numberOfLines={1}>
            {modelId}
          </Text>
        </View>
        {hop ? <Badge tone={isFail ? 'danger' : 'success'} label={VERDICT_LABEL[hop.verdict] ?? hop.verdict} /> : null}
      </View>

      <View style={styles.metaRow}>
        {hop?.paramsB ? <Text style={styles.meta}>{hop.paramsB}B params</Text> : null}
        {hop && hop.cacheHit !== 'none' ? <Badge tone="accent" label={`cache: ${hop.cacheHit}`} /> : null}
        {!hop && !isFail ? <Text style={styles.meta}>running...</Text> : null}
      </View>

      {expanded && decision ? (
        <View style={styles.expanded}>
          {decision.reasons.map((reason, i) => (
            <Text key={i} style={styles.reason}>
              · {reason}
            </Text>
          ))}
          {hop ? (
            <Text style={styles.stats}>
              ${hop.costUsd.toFixed(5)} · {hop.latencyMs}ms · {hop.promptTokens}→{hop.completionTokens} tok
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Badge({ tone, label }: { tone: 'success' | 'danger' | 'accent'; label: string }) {
  const color = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.accentBright;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardFail: { borderColor: colors.danger },
  cardEscalation: { borderColor: colors.accentDim },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  modelInfo: { flex: 1, gap: 2 },
  escalationTag: { ...typography.caption, color: colors.ember },
  modelId: { ...typography.mono, color: colors.textPrimary, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  meta: { ...typography.label, color: colors.textTertiary },
  badge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { ...typography.caption },
  expanded: { marginTop: spacing.sm, gap: 4, borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: spacing.sm },
  reason: { ...typography.label, color: colors.textSecondary },
  stats: { ...typography.mono, color: colors.textTertiary, marginTop: 4 },
});
