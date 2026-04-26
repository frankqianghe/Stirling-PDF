/**
 * Global fetch interceptor — logs every HTTP request the renderer makes,
 * with full request/response transcripts, into a daily log file.
 *
 * Convert / OCR fetches are SKIPPED here because `loggedFetch` in
 * `taskService.ts` already writes their full transcript into a per-task
 * log file. Those calls flag themselves by passing
 * `[SKIP_FETCH_LOG_KEY]: true` in the `RequestInit`; native `fetch`
 * silently ignores unknown init properties, so we can read it before
 * calling through to the original fetch implementation.
 *
 * IMPORTANT — non-blocking & memory-safe contract
 * -----------------------------------------------
 * 1. The patched fetch returns the response to the caller AS SOON AS the
 *    network call resolves. Reading the response body for logging is
 *    always done on a clone, in the background.
 * 2. Body reading is BOUNDED: at most `MAX_LOG_BODY_BYTES` are read from
 *    the cloned stream, then the reader is cancelled. This prevents the
 *    cloned response's tee-buffer from holding huge downloads (PDFs,
 *    fonts, telemetry beacons, …) in memory and starving the renderer.
 * 3. Binary / oversized responses skip body reading entirely — only the
 *    metadata block is logged. The body of the clone is `cancel()`-ed
 *    immediately so memory is freed.
 * 4. Local dev-server / HMR / `data:` / `blob:` URLs are filtered out
 *    before logging so Vite chunk fetches don't drown the daily log and,
 *    more importantly, don't busy-loop the logger.
 * 5. Any error inside the logger is swallowed and the patched fetch
 *    falls through to the original implementation.
 */

import {
  describeHeaders,
  describeRequestBody,
  describeResponseBody,
  describeResponseHeaders,
  maybeParseJson,
} from '@app/services/httpLogFormat';
import { logDaily } from '@app/services/dailyLogService';

/**
 * Init flag callers (such as `loggedFetch` in `taskService.ts`) set to
 * suppress duplicate daily logging when they already maintain their own
 * detailed log.
 */
export const SKIP_FETCH_LOG_KEY = '__plexpdfSkipFetchLog' as const;

/** Hard cap on how many bytes of the response body we drain for logging. */
const MAX_LOG_BODY_BYTES = 32 * 1024;

/** Above this Content-Length we skip body reading entirely. */
const MAX_LOGGABLE_CONTENT_LENGTH = 256 * 1024;

/**
 * Host allow-list. We only record HTTP traffic going to the PlexPDF
 * backend (the same base URL used to submit convert/OCR jobs). Everything
 * else — localhost dev server, Vite HMR, PostHog telemetry, CDN font
 * downloads, … — is intentionally ignored so the daily log stays focused
 * on backend interactions worth diagnosing.
 *
 * Add additional production / staging hosts here as they come online.
 */
const LOGGED_HOSTS: ReadonlySet<string> = new Set([
  'plexpdf-test.wenxstudio.ai',
  'plexpdf.wenxstudio.ai',
]);

/** Domain suffixes that are also accepted (e.g. any `*.wenxstudio.ai` host). */
const LOGGED_HOST_SUFFIXES: readonly string[] = ['.wenxstudio.ai'];

let installed = false;

interface RequestSnapshot {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
  bodyNote?: string;
}

function urlFromInput(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  } catch {
    return '<unknown url>';
  }
}

function methodFromInput(input: RequestInfo | URL, init?: RequestInit): string {
  try {
    if (init?.method) return init.method.toUpperCase();
    if (input instanceof Request) return input.method.toUpperCase();
  } catch {
    /* fall through */
  }
  return 'GET';
}

function headersToRecord(h: HeadersInit | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  try {
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    if (Array.isArray(h)) {
      for (const [k, v] of h) out[String(k)] = String(v);
      return out;
    }
    for (const [k, v] of Object.entries(h)) out[k] = String(v);
  } catch {
    /* swallow */
  }
  return out;
}

/**
 * URL-level filter: returns `true` only for URLs we DO want to log.
 * Allow-list approach — only the PlexPDF backend host(s) (the same
 * base URL used to submit convert/OCR jobs) get logged. Anything else
 * (localhost, Vite, PostHog, CDN, file://, …) is silently skipped.
 *
 * Exported for use by `tauriHttpClient`, which bypasses `window.fetch`
 * and therefore needs to make the same allow-list decision before
 * writing into the daily log.
 */
export function shouldLogUrl(url: string): boolean {
  if (!url) return false;

  let parsed: URL;
  try {
    // Guard against relative URLs by giving a base; relative URLs to the
    // dev server are local traffic and we don't want to log them anyway.
    parsed = new URL(url, 'http://localhost');
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  // Explicitly skip local dev hosts even if they sneak through.
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
    return false;
  }

  if (LOGGED_HOSTS.has(host)) return true;
  for (const suffix of LOGGED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Fully synchronous request snapshot — we MUST NOT block the network
 * call waiting for body extraction. If the caller passed a Request
 * object whose body can only be obtained asynchronously, we just note
 * "<Request body>" and move on.
 */
function snapshotRequest(input: RequestInfo | URL, init?: RequestInit): RequestSnapshot {
  const url = urlFromInput(input);
  const method = methodFromInput(input, init);

  if (input instanceof Request) {
    const headers = headersToRecord(input.headers);
    if (init?.headers) Object.assign(headers, headersToRecord(init.headers));
    const body = init?.body ?? null;
    return {
      method,
      url,
      headers,
      body,
      bodyNote: body == null ? '<Request object body — not captured>' : undefined,
    };
  }

  return {
    method,
    url,
    headers: headersToRecord(init?.headers),
    body: init?.body ?? null,
  };
}

function logRequestBlock(snap: RequestSnapshot): void {
  const lines: string[] = [];
  lines.push('────────── HTTP REQUEST ──────────');
  lines.push(`  ${snap.method} ${snap.url}`);
  lines.push(...describeHeaders(snap.headers));
  if (snap.bodyNote && snap.body == null) {
    lines.push(`  Body: ${snap.bodyNote}`);
  } else {
    lines.push(...describeRequestBody(snap.body));
  }
  logDaily('INFO', lines.join('\n'));
}

function buildResponseHeader(
  snap: RequestSnapshot,
  status: number,
  statusText: string,
  headers: Headers,
  durationMs: number,
): string[] {
  const respLike = {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    headers,
  } as Response;
  const lines: string[] = [];
  lines.push('────────── HTTP RESPONSE ──────────');
  lines.push(`  ${snap.method} ${snap.url}`);
  lines.push(`  Status: ${status} ${statusText}`);
  lines.push(`  Duration: ${durationMs}ms`);
  lines.push(...describeResponseHeaders(respLike));
  return lines;
}

function logFailure(snap: RequestSnapshot, err: unknown, durationMs: number): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const lines: string[] = [];
  lines.push('────────── HTTP NETWORK FAILURE ──────────');
  lines.push(`  ${snap.method} ${snap.url}`);
  lines.push(`  Duration: ${durationMs}ms`);
  lines.push(`  Error: ${msg}`);
  logDaily('ERROR', lines.join('\n'));
}

/**
 * Public, transport-agnostic API for emitting the same daily HTTP log
 * blocks that the global `window.fetch` interceptor produces.
 *
 * `tauriHttpClient` (which uses `@tauri-apps/plugin-http` fetch and
 * therefore bypasses `window.fetch`) calls these helpers so its traffic
 * — order/create, license activation, device register, … — also lands
 * in the daily log.
 *
 * All helpers are silent on URLs that fall outside the allow-list, so
 * callers can invoke them unconditionally without checking themselves.
 */
export function logHttpRequest(args: {
  method: string;
  url: string;
  headers?: Record<string, string> | Headers | null;
  body?: BodyInit | null;
}): void {
  if (!shouldLogUrl(args.url)) return;
  try {
    const snap: RequestSnapshot = {
      method: (args.method || 'GET').toUpperCase(),
      url: args.url,
      headers:
        args.headers instanceof Headers
          ? headersToRecord(args.headers)
          : { ...(args.headers ?? {}) },
      body: args.body ?? null,
    };
    logRequestBlock(snap);
  } catch (err) {
    try {
      console.warn('[fetchLogger] Failed to log request:', err);
    } catch {
      /* swallow */
    }
  }
}

export function logHttpResponse(args: {
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  /**
   * A clone of the response. The helper drains it (bounded) in the
   * background — callers MUST NOT use this object themselves.
   */
  responseClone: Response;
}): void {
  if (!shouldLogUrl(args.url)) return;
  try {
    const snap: RequestSnapshot = {
      method: (args.method || 'GET').toUpperCase(),
      url: args.url,
      headers: {},
      body: null,
    };
    backgroundLogResponse(
      snap,
      args.responseClone,
      args.status,
      args.statusText,
      args.durationMs,
    );
  } catch (err) {
    try {
      console.warn('[fetchLogger] Failed to schedule response log:', err);
    } catch {
      /* swallow */
    }
  }
}

export function logHttpFailure(args: {
  method: string;
  url: string;
  durationMs: number;
  error: unknown;
}): void {
  if (!shouldLogUrl(args.url)) return;
  try {
    const snap: RequestSnapshot = {
      method: (args.method || 'GET').toUpperCase(),
      url: args.url,
      headers: {},
      body: null,
    };
    logFailure(snap, args.error, args.durationMs);
  } catch (err) {
    try {
      console.warn('[fetchLogger] Failed to log failure:', err);
    } catch {
      /* swallow */
    }
  }
}

/**
 * Decide whether the response body is worth (and safe to) read for
 * logging. We skip:
 *  - non-text-ish content types (images, fonts, PDFs, octet-stream …)
 *  - responses larger than `MAX_LOGGABLE_CONTENT_LENGTH`
 *  - 204 / 304 / no-body statuses
 */
function shouldReadBody(
  contentType: string,
  contentLength: number | null,
  status: number,
): { read: boolean; reason?: string } {
  if (status === 204 || status === 205 || status === 304) {
    return { read: false, reason: 'no-content status' };
  }
  if (contentLength != null && contentLength > MAX_LOGGABLE_CONTENT_LENGTH) {
    return {
      read: false,
      reason: `body skipped — Content-Length=${contentLength}B exceeds log limit`,
    };
  }
  const ct = (contentType || '').toLowerCase();
  if (!ct) return { read: true };

  if (
    ct.includes('json') ||
    ct.startsWith('text/') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('x-www-form-urlencoded') ||
    ct.includes('graphql')
  ) {
    return { read: true };
  }

  return {
    read: false,
    reason: `body skipped — non-text content-type "${contentType}"`,
  };
}

/**
 * Drain at most `limit` bytes from the response body, then `cancel()` the
 * stream so upstream stops buffering. Always resolves; never throws.
 */
async function readBoundedBody(
  resp: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!resp.body) {
    try {
      const text = await resp.text();
      if (text.length > limit) return { text: text.slice(0, limit), truncated: true };
      return { text, truncated: false };
    } catch {
      return { text: '', truncated: false };
    }
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = limit - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        total = limit;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
    if (truncated) {
      try {
        await reader.cancel();
      } catch {
        /* swallow */
      }
    }
  } catch {
    /* swallow — partial body is still useful */
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* swallow */
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(merged);
  } catch {
    text = '';
  }
  return { text, truncated };
}

/**
 * Read a clone of the response in the background and append a transcript
 * entry. By design this never blocks the original `fetch` caller and
 * never throws.
 */
function backgroundLogResponse(
  snap: RequestSnapshot,
  cloned: Response,
  status: number,
  statusText: string,
  durationMs: number,
): void {
  void Promise.resolve()
    .then(async () => {
      const headers = cloned.headers;
      const contentType = headers.get('content-type') || '';
      const lengthHeader = headers.get('content-length');
      const parsedLen = lengthHeader != null ? Number(lengthHeader) : NaN;
      const contentLength = Number.isFinite(parsedLen) ? parsedLen : null;

      const decision = shouldReadBody(contentType, contentLength, status);

      if (!decision.read) {
        try {
          await cloned.body?.cancel();
        } catch {
          /* swallow */
        }
        const lines = buildResponseHeader(snap, status, statusText, headers, durationMs);
        lines.push(`  Response body: <${decision.reason ?? 'skipped'}>`);
        const level = status >= 200 && status < 300 ? 'INFO' : 'ERROR';
        logDaily(level, lines.join('\n'));
        return;
      }

      const { text: bodyText, truncated } = await readBoundedBody(cloned, MAX_LOG_BODY_BYTES);
      const json = maybeParseJson(bodyText, contentType);

      const lines = buildResponseHeader(snap, status, statusText, headers, durationMs);
      if (truncated) {
        lines.push(`  Note: response body drained capped at ${MAX_LOG_BODY_BYTES}B`);
      }
      lines.push(...describeResponseBody(bodyText, json));
      const level = status >= 200 && status < 300 ? 'INFO' : 'ERROR';
      logDaily(level, lines.join('\n'));
    })
    .catch((err) => {
      try {
        console.warn('[fetchLogger] Failed to log response:', err);
      } catch {
        /* swallow */
      }
    });
}

/**
 * Patch `window.fetch` once. Idempotent — subsequent calls are no-ops.
 */
export function installFetchLogger(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Per-task convert/OCR fetches opt out via this flag.
    let skip = false;
    let strippedInit: RequestInit | undefined = init;
    try {
      if (init && (init as Record<string, unknown>)[SKIP_FETCH_LOG_KEY] === true) {
        skip = true;
        const { [SKIP_FETCH_LOG_KEY]: _omit, ...passThrough } = init as Record<string, unknown>;
        void _omit;
        strippedInit = passThrough as RequestInit;
      }
    } catch {
      return originalFetch(input, init);
    }

    if (skip) {
      return originalFetch(input, strippedInit);
    }

    // Allow-list: only log requests to the PlexPDF backend host(s).
    // All localhost / dev-server / 3rd-party traffic skips logging.
    let url: string;
    try {
      url = urlFromInput(input);
    } catch {
      return originalFetch(input, init);
    }
    if (!shouldLogUrl(url)) {
      return originalFetch(input, init);
    }

    let snap: RequestSnapshot | null = null;
    try {
      snap = snapshotRequest(input, init);
      logRequestBlock(snap);
    } catch (err) {
      try {
        console.warn('[fetchLogger] Failed to log request:', err);
      } catch {
        /* swallow */
      }
    }

    const startedAt = performance.now();
    let resp: Response;
    try {
      resp = await originalFetch(input, init);
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      if (snap) {
        try {
          logFailure(snap, err, durationMs);
        } catch {
          /* swallow */
        }
      }
      throw err;
    }
    const durationMs = Math.round(performance.now() - startedAt);

    // Non-blocking response logging. Cloning is cheap (it tees the
    // stream); the bounded reader inside `backgroundLogResponse` makes
    // sure the tee buffer is freed quickly even for huge downloads.
    if (snap) {
      try {
        const cloned = resp.clone();
        backgroundLogResponse(snap, cloned, resp.status, resp.statusText, durationMs);
      } catch (err) {
        try {
          console.warn('[fetchLogger] Failed to schedule response log:', err);
        } catch {
          /* swallow */
        }
      }
    }

    return resp;
  };
}
