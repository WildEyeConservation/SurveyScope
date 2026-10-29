const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function neutraliseCsvFormula<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  if (!FORMULA_PREFIX.test(value) || NUMERIC.test(value)) return value;
  return `'${value}`;
}

export function neutraliseCsvRows<T extends Record<string, unknown>>(
  rows: T[]
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        // export-from-json only quotes cells containing LF
        neutraliseCsvFormula(
          typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value
        )
      ])
    )
  );
}

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(neutraliseCsvFormula(value));
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}
