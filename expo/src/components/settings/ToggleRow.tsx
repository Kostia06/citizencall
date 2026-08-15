import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing, typography } from '../../theme/typography';

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange(value: boolean): void;
}

export function ToggleRow({ label, description, value, onValueChange }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
        thumbColor={value ? colors.accent : colors.textTertiary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  label: { ...typography.title, color: colors.textPrimary },
  description: { ...typography.label, color: colors.textTertiary },
});
