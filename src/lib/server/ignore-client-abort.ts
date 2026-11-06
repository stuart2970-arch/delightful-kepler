/**
 * A browser that navigates away mid-stream resets the socket. Node then raises
 * an uncaught ECONNRESET ("aborted"). With a listener installed, that abort
 * does not exit the dev server. Any other uncaught exception still exits.
 */
export function ignoreClientAbort() {
  const marker = '__stylefloIgnoreClientAbort';
  const globalState = globalThis as typeof globalThis & { [marker]?: boolean };
  if (globalState[marker]) return;
  globalState[marker] = true;

  process.on('uncaughtException', (err: unknown) => {
    const error = err as { code?: string; message?: string; name?: string };
    const aborted = error?.code === 'ECONNRESET'
      || error?.name === 'AbortError'
      || error?.message === 'aborted';
    if (aborted) return;
    console.error('[Server] Uncaught exception:', err);
    process.exit(1);
  });
}
