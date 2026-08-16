import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../src/components/ui/Screen';
import { CommandBar } from '../../src/components/command/CommandBar';
import { TurnCard } from '../../src/components/command/TurnCard';
import { colors } from '../../src/theme/colors';
import { spacing, typography } from '../../src/theme/typography';
import { conversationReducer, initialConversationState } from '../../src/lib/conversationReducer';
import { startRun, type RunHandle } from '../../src/api/runClient';
import { storeApi } from '../../src/api/storeClient';
import { ANON_USER_ID } from '../../src/api/config';
import { useAuth } from '../../src/auth/AuthContext';

// Recent-prompts window sent as suggest() context — matches
// ui/src/components/CommandBar.tsx's usage (last few prompts, most recent
// last); unbounded history isn't useful context and would bloat the payload.
const RECENT_PROMPTS_WINDOW = 5;

export default function CommandScreen() {
  const { user, authedFetch } = useAuth();
  const [state, dispatch] = useReducer(conversationReducer, undefined, initialConversationState);
  const [running, setRunning] = useState(false);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const runRef = useRef<RunHandle | null>(null);
  const lastEscalateTickRef = useRef(0);

  useEffect(() => () => runRef.current?.close(), []);

  useEffect(() => {
    storeApi
      .getSettings(authedFetch)
      .then((prefs) => setSuggestionsEnabled(prefs.suggestions))
      .catch(() => undefined); // keep the default (on) if settings can't load
  }, [authedFetch]);

  // Ticks a light haptic whenever the active turn's escalateTick advances —
  // the native stand-in for DESIGN.md §5's conic-border ring speed spike,
  // since there's no equivalent running-border affordance on the input pill.
  useEffect(() => {
    const lastTurn = state.turns[state.turns.length - 1];
    const tick = lastTurn?.trace.escalateTick ?? 0;
    if (tick > lastEscalateTickRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }
    lastEscalateTickRef.current = tick;
  }, [state.turns]);

  const recentPrompts = useMemo(
    () => state.turns.slice(-RECENT_PROMPTS_WINDOW).map((t) => t.prompt),
    [state.turns],
  );

  const handleSubmit = useCallback(
    (text: string, opts: { source: 'text' | 'voice' }) => {
      if (running) return;
      setRunning(true);

      const turnId = `turn-${Date.now().toString(36)}`;
      dispatch({ type: 'start_turn', id: turnId, prompt: text, source: opts.source });

      runRef.current?.close();
      runRef.current = startRun({
        userId: user?.id ?? ANON_USER_ID,
        text,
        onEvent: (event) => {
          dispatch({ type: 'trace_event', event });
          if (event.t === 'run_end' || event.t === 'error') setRunning(false);
        },
        onError: () => {
          setRunning(false);
          // The POST /api/run itself failed (network down, before any trace
          // event arrived) — without this the turn sits on "planning..."
          // forever with no explanation. Routes through the same reducer
          // case TurnCard already renders for a mid-run `error` event.
          dispatch({ type: 'trace_event', event: { t: 'error', message: 'Could not reach the run service.' } });
        },
      });
    },
    [running, user],
  );

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // No offset needed: this screen's flex box already sits above the
        // tab bar (a sibling outside this tree), so `padding` behavior
        // alone keeps the bar pinned just above the keyboard.
      >
        {state.turns.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>What do you need done?</Text>
            <Text style={styles.emptySubtitle}>
              Understudy routes each step to the cheapest model that can do it, escalating only on failure.
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {state.turns.map((turn) => (
              <TurnCard key={turn.id} turn={turn} />
            ))}
          </ScrollView>
        )}

        <View style={styles.inputDock}>
          <CommandBar
            running={running}
            suggestionsEnabled={suggestionsEnabled}
            recentPrompts={recentPrompts}
            authedFetch={authedFetch}
            onSubmit={handleSubmit}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  inputDock: { padding: spacing.lg, paddingTop: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.headline2, color: colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
});
