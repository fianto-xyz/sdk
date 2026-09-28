export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/** Runs a merchant-supplied reporter; a throwing one must never change the response. */
export function report(fn: () => void): void {
  try {
    fn();
  } catch {
    // Swallowed on purpose: the response is already decided.
  }
}
