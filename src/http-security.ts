import { createHash, timingSafeEqual } from "node:crypto";

export function isHttpMode(mode: string): boolean {
  return mode === "sse" || mode === "http";
}

export function httpAuthConfigurationError(
  mode: string,
  authToken: string
): string | null {
  if (isHttpMode(mode) && authToken.length < 32) {
    return "HTTP mode requires MCP_AUTH_TOKEN containing at least 32 characters.";
  }
  return null;
}

export function bearerTokenMatches(
  authorizationHeader: string | undefined,
  authToken: string
): boolean {
  const presented = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice(7)
    : "";
  if (!presented) return false;

  const suppliedDigest = createHash("sha256").update(presented).digest();
  const expectedDigest = createHash("sha256").update(authToken).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function originAllowed(
  origin: string | undefined,
  allowedOrigins: string[]
): boolean {
  return !origin || allowedOrigins.includes(origin);
}
