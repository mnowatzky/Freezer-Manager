// Client-side error reporting: sends uncaught errors to the API, which logs them as
// structured JSON lines (see /api/client-errors). Throttled so a render loop can't flood it.

const MAX_REPORTS_PER_PAGE = 10;
let sent = 0;

export function reportError(error: unknown, context?: string) {
  if (sent >= MAX_REPORTS_PER_PAGE) return;
  sent++;
  const err = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({
    message: err.message.slice(0, 500),
    stack: err.stack?.slice(0, 4000),
    context,
    url: location.pathname,
    userAgent: navigator.userAgent,
  });
  // keepalive lets the report go out even while the page unloads.
  fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
    () => {},
  );
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window.error"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandledrejection"));
}
