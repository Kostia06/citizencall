// Auto-grow ceiling for the command bar's multiline input — mirrors
// ui/src/components/CommandBar.tsx's MAX_LINES=6 cap. RN's
// TextInput.onContentSizeChange reports the real laid-out content height
// directly (already reflecting Dynamic Type scaling), unlike the web's
// scrollHeight-measuring dance against a detached element, so there's no
// separate remeasure step here — just clamp what RN already gave us.
export const MAX_LINES = 6;

export function clampInputHeight(contentHeight: number, lineHeight: number, minHeight: number): number {
  const maxHeight = lineHeight * MAX_LINES;
  return Math.min(Math.max(minHeight, contentHeight), maxHeight);
}
