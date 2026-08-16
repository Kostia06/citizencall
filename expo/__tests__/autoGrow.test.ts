import { clampInputHeight, MAX_LINES } from '../src/lib/autoGrow';

describe('clampInputHeight', () => {
  const lineHeight = 22.5; // 15px * 1.5

  it('never shrinks below the single-line minimum', () => {
    expect(clampInputHeight(4, lineHeight, lineHeight)).toBe(lineHeight);
  });

  it('grows with content up to the MAX_LINES ceiling', () => {
    const twoLines = lineHeight * 2;
    expect(clampInputHeight(twoLines, lineHeight, lineHeight)).toBe(twoLines);
  });

  it('caps at MAX_LINES worth of height even if content is taller', () => {
    const capped = lineHeight * MAX_LINES;
    expect(clampInputHeight(capped * 3, lineHeight, lineHeight)).toBe(capped);
  });
});
