/**
 * Slugify — kebab-case, ASCII, dedupe-safe.
 */
export function slugify(input: string, maxLen = 48): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
  return base || "qr";
}

const RESERVED = new Set([
  "api", "admin", "admin.html", "assets", "static", "_next",
  "favicon.ico", "robots.txt", "tenants", "docs",
]);

export function isReservedSlug(s: string): boolean {
  return RESERVED.has(s) || s.startsWith("_") || s.includes("..");
}

/** Append a short random suffix to keep slugs unique. */
export function uniquify(slug: string): string {
  const r = Math.random().toString(36).slice(2, 6);
  return `${slug}-${r}`;
}
