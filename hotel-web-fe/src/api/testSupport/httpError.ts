import { HTTPError } from 'ky';

/**
 * Build a ky `HTTPError` the way a real failed request throws one.
 *
 * ky 2 parses the response body into `error.data` BEFORE throwing, and that
 * read CONSUMES the response stream. So on a genuine error
 * `error.response.json()` rejects with "Body is unusable" and only
 * `error.data` still carries the server's message.
 *
 * A fixture has to reproduce both halves. Setting `data` alone leaves the
 * stream readable, which lets code that (wrongly) reads
 * `error.response.json()` keep passing — a test that cannot fail, the trap
 * described in lessons theme 13. Starting the read here disturbs the stream
 * exactly as ky does, so that regression fails loudly instead.
 */
export function buildKyHttpError(
  status: number,
  body: unknown,
  url = 'http://localhost/api/test',
): HTTPError {
  const response = new Response(JSON.stringify(body), {
    status,
    statusText: 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
  const request = new Request(url, { method: 'POST' });
  const error = new HTTPError(response, request, {} as never);
  (error as unknown as { data: unknown }).data = body;
  // Consume the stream, exactly as ky does before it throws.
  void response.json().catch(() => undefined);
  return error;
}
