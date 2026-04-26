/**
 * Shared formatting helpers for HTTP request / response logging.
 *
 * Used by:
 *  - `taskService.ts` `loggedFetch`            — per-task convert / OCR logs
 *  - `fetchLogger.ts` global fetch interceptor — daily generic logs
 *
 * The output is intentionally human-readable plain text (single multi-line
 * block per direction) so `tail -f` / opening the log in a text editor
 * gives an immediately useful trace.
 */

/** Hard cap on body sizes we log. Bigger bodies are truncated. */
export const MAX_BODY_LOG_BYTES = 16 * 1024;

export function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

export function describeFormData(form: FormData): string[] {
  const lines: string[] = [];
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      lines.push(
        `    ${key} = <File name="${value.name}" size=${value.size}B type="${value.type || 'application/octet-stream'}" lastModified=${value.lastModified}>`,
      );
    } else if (value instanceof Blob) {
      lines.push(
        `    ${key} = <Blob size=${value.size}B type="${value.type || 'application/octet-stream'}">`,
      );
    } else {
      lines.push(`    ${key} = ${JSON.stringify(value)}`);
    }
  }
  return lines;
}

export function describeRequestBody(body: BodyInit | null | undefined): string[] {
  if (body == null) return ['  Body: <none>'];
  if (body instanceof FormData) {
    const lines = ['  Body (multipart/form-data):'];
    const fields = describeFormData(body);
    if (fields.length === 0) lines.push('    <empty>');
    else lines.push(...fields);
    return lines;
  }
  if (body instanceof URLSearchParams) {
    const lines = ['  Body (application/x-www-form-urlencoded):'];
    for (const [k, v] of body.entries()) lines.push(`    ${k} = ${JSON.stringify(v)}`);
    if (lines.length === 1) lines.push('    <empty>');
    return lines;
  }
  if (body instanceof Blob) {
    return [
      `  Body: <Blob size=${body.size}B type="${body.type || 'application/octet-stream'}">`,
    ];
  }
  if (body instanceof ArrayBuffer) {
    return [`  Body: <ArrayBuffer size=${body.byteLength}B>`];
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return [
      `  Body: <${view.constructor.name} size=${view.byteLength}B>`,
    ];
  }
  if (typeof body === 'string') {
    const truncated = body.length > MAX_BODY_LOG_BYTES;
    const text = truncated ? body.slice(0, MAX_BODY_LOG_BYTES) : body;
    return [
      `  Body (string, ${body.length}B${truncated ? ', TRUNCATED' : ''}):`,
      indent(text, '    '),
    ];
  }
  return [`  Body: <unknown type ${Object.prototype.toString.call(body)}>`];
}

export function describeHeaders(
  headers: Record<string, string> | Headers | undefined | null,
  prefix = '  ',
): string[] {
  const entries: [string, string][] = [];
  if (headers) {
    if (headers instanceof Headers) {
      headers.forEach((v, k) => entries.push([k, v]));
    } else {
      for (const [k, v] of Object.entries(headers)) entries.push([k, String(v)]);
    }
  }
  if (entries.length === 0) return [`${prefix}Headers: <none>`];
  const lines = [`${prefix}Headers:`];
  for (const [k, v] of entries) lines.push(`${prefix}  ${k}: ${v}`);
  return lines;
}

export function describeResponseHeaders(resp: Response): string[] {
  const entries: [string, string][] = [];
  resp.headers.forEach((value, key) => entries.push([key, value]));
  if (entries.length === 0) return ['  Response headers: <none>'];
  const lines = ['  Response headers:'];
  for (const [k, v] of entries) lines.push(`    ${k}: ${v}`);
  return lines;
}

export function describeResponseBody(bodyText: string, json: unknown): string[] {
  if (!bodyText) return ['  Response body: <empty>'];
  const truncated = bodyText.length > MAX_BODY_LOG_BYTES;
  const display = truncated ? bodyText.slice(0, MAX_BODY_LOG_BYTES) : bodyText;
  const lines: string[] = [];
  if (json !== undefined) {
    let pretty: string;
    try {
      pretty = JSON.stringify(json, null, 2);
    } catch {
      pretty = display;
    }
    const prettyTruncated = pretty.length > MAX_BODY_LOG_BYTES;
    const prettyDisplay = prettyTruncated
      ? pretty.slice(0, MAX_BODY_LOG_BYTES)
      : pretty;
    lines.push(
      `  Response body (json, ${bodyText.length}B${prettyTruncated ? ', TRUNCATED' : ''}):`,
    );
    lines.push(indent(prettyDisplay, '    '));
  } else {
    lines.push(
      `  Response body (${bodyText.length}B${truncated ? ', TRUNCATED' : ''}):`,
    );
    lines.push(indent(display, '    '));
  }
  return lines;
}

/** Best-effort JSON-or-text parser used by the response describer. */
export function maybeParseJson(bodyText: string, contentType: string): unknown {
  if (!bodyText) return undefined;
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return undefined;
    }
  }
  const trimmed = bodyText.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
