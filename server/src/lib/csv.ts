const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Formats one CSV cell (RFC 4180). Values that a spreadsheet could treat as a formula are
 * prefixed with `'`; in numeric columns a plain negative number such as `-5.5` is left alone.
 */
export function csvCell(value: string | number | null, options: { numeric?: boolean } = {}) {
  if (value === null) return '';
  let text = String(value);
  if (FORMULA_TRIGGER.test(text) && !(options.numeric && PLAIN_NUMBER.test(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(cells: string[]): string {
  return `${cells.join(',')}\r\n`;
}
