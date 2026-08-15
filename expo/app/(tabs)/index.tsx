import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/ui/Screen';
import { CommandInput } from '../../src/components/command/CommandInput';
import { TurnCard } from '../../src/components/command/TurnCard';
import { colors } from '../../src/theme/colors';
import { spacing, typography } from '../../src/theme/typography';
import { conversationReducer, initialConversationState } from '../../src/lib/conversationReducer';
import { startRun, type RunHandle } from '../../src/api/runClient';
import { ANON_USER_ID } from '../../src/api/config';
import { useAuth } from '../../src/auth/AuthContext';

export default function CommandScreen() {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(conversationReducer, undefined, initialConversationState);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const runRef = useRef<RunHandle | null>(null);

  useEffect(() => () => runRef.current?.close(), []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setRunning(true);

    const turnId = `turn-${Date.now().toString(36)}`;
    dispatch({ type: 'start_turn', id: turnId, prompt: text, source: 'text' });

    runRef.current?.close();
    runRef.current = startRun({
      userId: user?.id ?? ANON_USER_ID,
      text,
      onEvent: (event) => {
        dispatch({ type: 'trace_event', event });
        if (event.t === 'run_end' || event.t === 'error') setRunning(false);
      },
      onError: () => setRunning(false),
    });
  }, [input, running, user]);

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
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
          <CommandInput value={input} onChangeText={setInput} onSubmit={handleSubmit} disabled={running} />
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
