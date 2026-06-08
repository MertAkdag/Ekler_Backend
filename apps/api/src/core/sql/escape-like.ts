/**
 * Escape LIKE/ILIKE metacharacters in user input so `%term%` searches can't be
 * subverted with `%` / `_` wildcards (same class as the Y-3 hardening). Uses the
 * default Postgres escape char `\`.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`)
}
