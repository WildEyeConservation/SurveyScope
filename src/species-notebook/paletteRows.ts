import type { SurveyCategory } from './types';

export type PaletteRow = {
  name: string;
  color: string | null;
  categoryIds: string[];
  inSurvey: boolean;
};

export function matchScore(name: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[^a-z0-9]+/).some((word) => word.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  return null;
}

export function groupByName(categories: readonly SurveyCategory[]) {
  const groups = new Map<string, SurveyCategory[]>();
  for (const category of categories) {
    const group = groups.get(category.name);
    if (group) group.push(category);
    else groups.set(category.name, [category]);
  }
  return groups;
}

export function buildPaletteRows(input: {
  surveyCategories: readonly SurveyCategory[];
  otherNames?: Iterable<string>;
  query: string;
}): { present: PaletteRow[]; absent: PaletteRow[] } {
  const rows: PaletteRow[] = [];
  for (const [name, group] of groupByName(input.surveyCategories)) {
    rows.push({
      name,
      color: group.find((category) => category.color)?.color ?? null,
      categoryIds: group.map((category) => category.id),
      inSurvey: true,
    });
  }
  const query = input.query.trim();
  if (query) {
    const seen = new Set(rows.map((row) => row.name));
    for (const name of input.otherNames ?? []) {
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, color: null, categoryIds: [], inSurvey: false });
    }
  }
  const scored = rows
    .map((row) => ({ row, score: matchScore(row.name, query) }))
    .filter(
      (entry): entry is { row: PaletteRow; score: number } =>
        entry.score !== null,
    )
    .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name))
    .map((entry) => entry.row);
  return {
    present: scored.filter((row) => row.inSurvey),
    absent: scored.filter((row) => !row.inSurvey),
  };
}
