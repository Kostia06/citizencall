import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import * as WebBrowser from 'expo-web-browser';
import { Screen } from '../../src/components/ui/Screen';
import { TextField } from '../../src/components/ui/TextField';
import { AppTile } from '../../src/components/connections/AppTile';
import { CategoryChips } from '../../src/components/connections/CategoryChips';
import { colors } from '../../src/theme/colors';
import { spacing, typography } from '../../src/theme/typography';
import { APPS, TOP_CATEGORIES } from '../../src/store/apps';
import type { ToolkitApp } from '../../src/store/apps';
import { storeApi } from '../../src/api/storeClient';
import { useAuth } from '../../src/auth/AuthContext';

const RENDER_CAP = 300; // matches ui/ConnectionsPanel.tsx's cap on the 1,201-app catalog

export default function ConnectionsScreen() {
  const { authedFetch } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshConnections = useCallback(async () => {
    const list = await storeApi.listConnections(authedFetch).catch(() => []);
    setConnected(Object.fromEntries(list.filter((c) => c.status === 'active').map((c) => [c.toolkit, true])));
  }, [authedFetch]);

  const handlePullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshConnections();
    } finally {
      setRefreshing(false);
    }
  }, [refreshConnections]);

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return APPS.filter((app) => {
      if (category && app.category !== category) return false;
      if (!q) return true;
      return app.name.toLowerCase().includes(q) || app.category.toLowerCase().includes(q);
    }).slice(0, RENDER_CAP);
  }, [query, category]);

  const handlePress = useCallback(
    async (app: ToolkitApp) => {
      setBusy(app.slug);
      try {
        if (connected[app.slug]) {
          await storeApi.disconnect(authedFetch, app.slug);
        } else {
          const { url } = await storeApi.connect(authedFetch, app.slug);
          if (url && url !== '#') await WebBrowser.openAuthSessionAsync(url);
        }
        await refreshConnections();
      } finally {
        setBusy(null);
      }
    },
    [authedFetch, connected, refreshConnections],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Connections</Text>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search 1,201 apps..."
          returnKeyType="search"
        />
        <CategoryChips categories={TOP_CATEGORIES} active={category} onSelect={setCategory} />
      </View>

      <FlashList
        data={filtered}
        keyExtractor={(app) => app.slug}
        numColumns={3}
        contentContainerStyle={styles.grid}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handlePullToRefresh} tintColor={colors.textTertiary} />
        }
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <AppTile app={item} connected={Boolean(connected[item.slug])} busy={busy === item.slug} onPress={() => handlePress(item)} />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No apps match "{query}".</Text>}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  title: { ...typography.headline2, color: colors.textPrimary },
  grid: { padding: spacing.lg },
  cell: { flex: 1, alignItems: 'center', marginBottom: spacing.md },
  empty: { ...typography.body, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
});
