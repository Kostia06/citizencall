import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/ui/Screen';
import { TextField } from '../../src/components/ui/TextField';
import { Button } from '../../src/components/ui/Button';
import { ToggleRow } from '../../src/components/settings/ToggleRow';
import { colors } from '../../src/theme/colors';
import { spacing, typography } from '../../src/theme/typography';
import { storeApi } from '../../src/api/storeClient';
import { DEFAULT_PREFS } from '../../src/types/store';
import { useAuth } from '../../src/auth/AuthContext';

export default function SettingsScreen() {
  const { status, user, authedFetch, logout } = useAuth();
  const [contextPrompt, setContextPrompt] = useState(DEFAULT_PREFS.contextPrompt);
  const [suggestions, setSuggestions] = useState(DEFAULT_PREFS.suggestions);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storeApi.getSettings(authedFetch).then((prefs) => {
      setContextPrompt(prefs.contextPrompt);
      setSuggestions(prefs.suggestions);
    });
  }, [authedFetch]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await storeApi.putSettings(authedFetch, { contextPrompt, suggestions });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <Text style={styles.accountLine}>{status === 'authed' ? user?.email : 'Browsing anonymously (demo data)'}</Text>
          {status === 'authed' ? (
            <Button label="Log out" variant="secondary" onPress={logout} />
          ) : (
            <Button label="Log in" variant="secondary" onPress={() => router.push('/(auth)/login')} />
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Context</Text>
          <TextField
            label="Context prompt"
            value={contextPrompt}
            onChangeText={setContextPrompt}
            placeholder="e.g. Prefer concise summaries; my repo is understudy/agent."
            multiline
            numberOfLines={4}
            style={styles.multiline}
          />
          <ToggleRow
            label="Suggestions"
            description="Show a context-aware next-action suggestion after each run."
            value={suggestions}
            onValueChange={setSuggestions}
          />
        </View>

        <Button label={saved ? 'Saved' : 'Save changes'} onPress={save} loading={saving} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
  title: { ...typography.headline2, color: colors.textPrimary },
  section: { gap: spacing.md },
  sectionLabel: { ...typography.caption, color: colors.textTertiary },
  accountLine: { ...typography.body, color: colors.textSecondary },
  multiline: { height: 96, textAlignVertical: 'top', paddingTop: spacing.sm },
});
