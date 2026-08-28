import { randomBytes } from "node:crypto";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self' wss://dash.rozkalns.net",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self'",
].join("; ");

export const REFERRER_POLICY = "no-referrer";

export const PERMISSIONS_POLICY = [
  "camera=()",
  "geolocation=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

interface HeaderWriter {
  header(name: string, value: string): unknown;
}

function isOperationalApiRequest(requestUrl: string): boolean {
  return (
    requestUrl === "/api" ||
    requestUrl.startsWith("/api?") ||
    requestUrl.startsWith("/api/")
  );
}

export function buildContentSecurityPolicy(nonce: string): string {
  return CONTENT_SECURITY_POLICY.replace(
    "script-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
  );
}

function createContentSecurityPolicyNonce(): string {
  return randomBytes(18).toString("base64");
}

export function applyHttpResponsePolicy(requestUrl: string, reply: HeaderWriter): void {
  reply.header(
    "Content-Security-Policy",
    buildContentSecurityPolicy(createContentSecurityPolicyNonce()),
  );
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", REFERRER_POLICY);
  reply.header("Permissions-Policy", PERMISSIONS_POLICY);

  if (isOperationalApiRequest(requestUrl)) {
    reply.header("Cache-Control", "no-store");
  }
}
