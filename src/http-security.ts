import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function fixedWindowRateLimit(maxRequests: number, windowMs = 60_000) {
  let windowStartedAt = Date.now();
  let requests = 0;

  return (_req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - windowStartedAt >= windowMs) {
      windowStartedAt = now;
      requests = 0;
    }
    requests += 1;
    res.setHeader("RateLimit-Limit", String(maxRequests));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, maxRequests - requests)));
    if (requests > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - windowStartedAt)) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

export function httpSecurity(allowedOrigins: readonly string[], token: string) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get("origin");
    if (origin && !allowed.has(origin)) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, mcp-session-id");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (!bearerMatches(req.get("authorization"), token)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
