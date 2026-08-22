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

export function applyHttpResponsePolicy(requestUrl: string, reply: HeaderWriter): void {
  reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", REFERRER_POLICY);
  reply.header("Permissions-Policy", PERMISSIONS_POLICY);

  if (isOperationalApiRequest(requestUrl)) {
    reply.header("Cache-Control", "no-store");
  }
}
