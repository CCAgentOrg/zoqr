/**
 * Shared helpers used by all route modules.
 *
 * Currently: tenant resolution. Single source of truth so every
 * route — public API, admin API, renderer — resolves the same way:
 *   ?tenant=... query param > X-ZoQR-Tenant header > "demo" default.
 */
import type { Context } from "hono";

export function tenantFrom(c: Context): string {
  return c.req.query("tenant") ?? c.req.header("x-zoqr-tenant") ?? "demo";
}
