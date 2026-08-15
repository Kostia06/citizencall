import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';

interface CategoryChipsProps {
  categories: string[];
  active: string | null;
  onSelect(category: string | null): void;
}

export function CategoryChips({ categories, active, onSelect }: CategoryChipsProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Chip label="All" selected={active === null} onPress={() => onSelect(null)} />
      {categories.map((c) => (
        <Chip key={c} label={c} selected={active === c} onPress={() => onSelect(c)} />
      ))}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipActive]}>
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, paddingVertical: spacing.xs },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.label, color: colors.textSecondary, textTransform: 'capitalize' },
  chipTextActive: { color: colors.void, fontWeight: '600' },
});
