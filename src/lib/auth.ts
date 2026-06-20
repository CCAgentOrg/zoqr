/**
 * Bearer-token auth for /admin/* and write APIs.
 *
 * Tokens are compared in constant time.
 * The ZOQR_API_TOKEN env var is the master token (super-admin).
 * Per-tenant tokens are stored in the wedges table (api_token column).
 */
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import type { Context, Next } from "hono";

function constantTimeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

export function newToken(bytes = 24): string {
  return `zq_${randomBytes(bytes).toString("base64url")}`;
}

/**
 * Middleware factory. requireAdmin() protects /admin/* routes.
 * The master token (ZOQR_API_TOKEN env) is always accepted.
 * If `tenant` is set in the URL, the per-tenant token is also accepted
 * (looked up against the wedges table — see routes/admin.ts).
 */
export function requireMasterToken() {
  return async (c: Context, next: Next) => {
    const secret = process.env.ZOQR_API_TOKEN;
    if (!secret) {
      return c.json(
        { error: "Server misconfigured: ZOQR_API_TOKEN is not set" },
        500
      );
    }
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !constantTimeEqual(token, secret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}

/**
 * Returns the bearer token from the request, or null.
 */
export function bearerToken(c: Context): string | null {
  const auth = c.req.header("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}
