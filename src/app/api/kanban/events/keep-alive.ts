/** How often the stream writes a keep-alive frame. */
export const KANBAN_SSE_PING_INTERVAL_MS = 25_000;
/**
 * Keep-alive frame. A named event with a data line: browsers dispatch it to
 * `addEventListener("ping")` so the client watchdog sees it, while plain
 * `onmessage` subscribers never do. A frame without `data:` is not dispatched
 * at all, and an SSE comment (`: ping`) is invisible to page code. No `id:`,
 * so it never moves the replay cursor, and it bypasses the broadcaster, so
 * it is never stored.
 */
export const KANBAN_SSE_PING_FRAME = "event: ping\ndata: {}\n\n";
