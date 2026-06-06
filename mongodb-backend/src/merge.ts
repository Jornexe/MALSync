export type TitleMergeMode = 'off' | 'exact' | 'fuzzy';

export function normalizeValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function normalizeUserKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : undefined;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  for (const el of value) {
    if (typeof el !== 'string') continue;
    const trimmed = el.trim();
    if (!trimmed) continue;
    dedupe.add(trimmed);
  }
  return [...dedupe];
}

export function mergeStringArrays(a: string[], b: string[]): string[] {
  const dedupe = new Set<string>();
  for (const el of a) if (el) dedupe.add(el);
  for (const el of b) if (el) dedupe.add(el);
  return [...dedupe];
}

export function normalizeTitleKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .trim()
    .replace(/[\W_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasStrongTitleContainment(a: string, b: string): boolean {
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 10) return false;
  return longer.includes(shorter);
}

function hasTitleMatch(rowKey: string, nextKey: string, mode: 'exact' | 'fuzzy'): boolean {
  if (mode === 'exact') return rowKey === nextKey;
  return rowKey === nextKey || hasStrongTitleContainment(rowKey, nextKey);
}

export function hasTitleOverlap(
  rowTitle: string,
  rowAltTitles: string[],
  nextTitle: string,
  nextAltTitles: string[],
  mode: TitleMergeMode,
): boolean {
  if (mode === 'off') return false;

  const rowKeys = new Set<string>(
    [normalizeTitleKey(rowTitle), ...rowAltTitles.map(normalizeTitleKey)].filter(Boolean),
  );
  const nextKeys = [normalizeTitleKey(nextTitle), ...nextAltTitles.map(normalizeTitleKey)].filter(
    Boolean,
  );

  for (const rowKey of rowKeys) {
    for (const nextKey of nextKeys) {
      if (hasTitleMatch(rowKey, nextKey, mode)) return true;
    }
  }
  return false;
}

export function preferString(current: string, incoming: string | undefined): string {
  if (incoming && incoming.trim()) return incoming;
  return current;
}
