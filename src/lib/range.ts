/**
 * Range parser — turns "Table 1-12", "Locker A-D", "Shelf 01-05" into a
 * flat array of slug candidates.
 *
 * Patterns supported:
 *   "Table 1-12"     → ["table-1","table-2",...,"table-12"]   (numeric range)
 *   "Locker A-D"     → ["locker-a","locker-b","locker-c","locker-d"]  (alpha range)
 *   "Front-Desk"     → ["front-desk"]                          (single slug)
 *
 * Numeric ranges zero-pad the suffix to match the end value's width:
 *   "Shelf 01-09"    → ["shelf-01","shelf-02",...,"shelf-09"]
 *   "Shelf 1-9"      → ["shelf-1","shelf-2",...,"shelf-9"]
 *   "Shelf 1-12"     → ["shelf-1","shelf-2",...,"shelf-12"]
 *
 * Returns a discriminated union so callers can tell "did you want a range?"
 * apart from "was this just one slug?".
 */
export type ParsedSlug =
  | { kind: "range"; prefix: string; suffixKind: "numeric" | "alpha"; start: number; end: number; pad: number }
  | { kind: "single"; slug: string };

const ALPHA_PATTERN = /^([A-Za-z])([A-Za-z])$/;

/**
 * Try to parse a raw slug pattern into either a single slug or a range.
 * If `taken` is provided, slugs already in that set are filtered out
 * (and returned as `taken_count` so the caller can report skips).
 */
export function parseSlug(raw: string): ParsedSlug | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Split on the last "-" so "shelf-a-1-12" still works (last segment is range).
  const m = trimmed.match(/^(.*?)-(\d+|\D)$/);
  if (!m) return { kind: "single", slug: trimmed };
  const prefix = m[1];
  const tail = m[2];

  // Numeric range: "...-1-12" → prefix="...-1", tail="12". Edge case.
  // More natural: "...-1-12" should be one range, so look for prefix-N-M.
  const numericRange = trimmed.match(/^(.+)-(\d+)-(\d+)$/);
  if (numericRange) {
    const pfx = numericRange[1];
    const a = Number(numericRange[2]);
    const b = Number(numericRange[3]);
    if (Number.isFinite(a) && Number.isFinite(b) && a < b && b - a <= 1000) {
      const pad = numericRange[2].length;
      return { kind: "range", prefix: pfx, suffixKind: "numeric", start: a, end: b, pad };
    }
  }

  // Alpha range: "...-A-D"
  const alphaRange = trimmed.match(/^(.+)-([a-zA-Z])-([a-zA-Z])$/);
  if (alphaRange) {
    const pfx = alphaRange[1];
    const a = alphaRange[2].toLowerCase();
    const b = alphaRange[3].toLowerCase();
    const ac = a.charCodeAt(0);
    const bc = b.charCodeAt(0);
    if (ac < bc && bc - ac <= 26) {
      return { kind: "range", prefix: pfx, suffixKind: "alpha", start: ac, end: bc, pad: 1 };
    }
  }

  // Single
  return { kind: "single", slug: trimmed };
}

/** Expand a ParsedSlug into a list of concrete slug strings. */
export function expand(p: ParsedSlug, max = 500): string[] {
  if (p.kind === "single") return [p.slug];
  const out: string[] = [];
  if (p.suffixKind === "numeric") {
    for (let i = p.start; i <= p.end; i++) {
      out.push(`${p.prefix}-${String(i).padStart(p.pad, "0")}`);
      if (out.length >= max) break;
    }
  } else {
    for (let i = p.start; i <= p.end; i++) {
      out.push(`${p.prefix}-${String.fromCharCode(i)}`);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Convenience: parse + expand + filter against taken set.
 * Returns the slugs that are safe to create, as {slug, parsed} pairs so the
 * caller can tell which came from a range vs a single.
 */
export function parseRange(
  raw: string,
  taken: Set<string>,
  max = 500
): { slug: string; parsed: ParsedSlug }[] {
  const p = parseSlug(raw);
  if (!p) return [];
  return expand(p, max)
    .filter((s) => !taken.has(s))
    .map((slug) => ({ slug, parsed: p }));
}
