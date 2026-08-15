import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';
import type { ToolkitApp } from '../../store/apps';

interface AppTileProps {
  app: ToolkitApp;
  connected: boolean;
  busy: boolean;
  onPress(): void;
}

/** One tile in the connections grid — logo, name, and a connected/connect
 * affordance. Falls back to an initials monogram if the hosted logo 404s,
 * same fallback ui/ConnectionsPanel.tsx uses for the bundled catalog. */
export function AppTile({ app, connected, busy, onPress }: AppTileProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <Pressable onPress={onPress} disabled={busy} style={[styles.tile, connected && styles.tileConnected]}>
      <View style={styles.logoWrap}>
        {!logoFailed ? (
          <Image source={{ uri: app.logo }} style={styles.logo} onError={() => setLogoFailed(true)} contentFit="contain" />
        ) : (
          <Text style={styles.monogram}>{app.name.slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {app.name}
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} style={styles.status} />
      ) : connected ? (
        <View style={styles.dot} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 96,
    height: 100,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: spacing.xs,
  },
  tileConnected: { borderColor: colors.accent },
  logoWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 36, height: 36, borderRadius: radius.sm },
  monogram: { ...typography.title, color: colors.textSecondary },
  name: { ...typography.caption, color: colors.textSecondary, textTransform: 'none', textAlign: 'center' },
  status: { position: 'absolute', top: 6, right: 6 },
  dot: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
});
