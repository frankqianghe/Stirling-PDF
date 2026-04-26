/**
 * eventReportService
 *
 * Fire-and-forget telemetry for product analytics. Posts a structured
 * payload to `${BASE_URL}/events` whenever a tracked product event
 * occurs (paywall popups, Buy Now clicks, checkout page loaded, …).
 *
 * Body schema:
 * {
 *   "app_version": string,
 *   "device_id":   string,
 *   "event_time":  number,    // unix epoch seconds, server is `int`
 *   "name":        string,    // event key, e.g. "checkout_popup_show"
 *   "os_version":  string,    // best-effort (platform + version)
 *   "value":       string     // optional, "" when none
 * }
 *
 * The service:
 *  - never throws (analytics must not break product flows);
 *  - lazily resolves app_version / os_version / device_id once and
 *    caches them in-process;
 *  - uses `tauriHttpClient` so it goes through the same logged HTTP
 *    pipeline (you can verify reports landed in the daily log).
 */

import { getVersion } from '@tauri-apps/api/app';
import tauriHttpClient from './tauriHttpClient';
import { deviceIdService } from './deviceIdService';
import { DEVICE_TOKEN_KEY } from './deviceRegisterService';

const EVENTS_BASE_URL = 'https://plexpdf-test.wenxstudio.ai';

/** Stable string keys for product events. Keep in sync with the spec. */
export type EventName =
  | 'checkout_popup_show'
  | 'checkout_function_show'
  | 'checkout_click_show'
  | 'checkout_order_year'
  // Note: spec uses `checkout_order_lifttime` (sic — double `t`).
  | 'checkout_order_lifttime'
  | 'lemonsqueezy_load_finished';

interface ReportEventBody {
  app_version: string;
  device_id: string;
  event_time: number;
  name: string;
  os_version: string;
  value: string;
}

let cachedAppVersion: string | null = null;
let cachedOsVersion: string | null = null;

async function resolveAppVersion(): Promise<string> {
  if (cachedAppVersion !== null) return cachedAppVersion;
  try {
    cachedAppVersion = await getVersion();
  } catch (err) {
    console.warn('[eventReportService] getVersion failed:', err);
    cachedAppVersion = '';
  }
  return cachedAppVersion;
}

/**
 * Best-effort OS family + version derived from `navigator.userAgent`.
 * Native plugin-os is intentionally NOT pulled in to keep the bundle
 * lean; the UA is reliable enough for product analytics.
 *
 *   macOS   → "macOS 10.15.7"
 *   Windows → "Windows 10"
 *   Linux   → "Linux"
 *   other   → raw UA truncated
 */
function detectOsVersion(): string {
  if (cachedOsVersion !== null) return cachedOsVersion;

  let detected = '';
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';

    const mac = ua.match(/Mac OS X (\d+[_\.]\d+(?:[_\.]\d+)?)/);
    if (mac) {
      detected = `macOS ${mac[1].replace(/_/g, '.')}`;
    } else {
      const win = ua.match(/Windows NT (\d+\.\d+)/);
      if (win) {
        const ntToFriendly: Record<string, string> = {
          '10.0': '10/11',
          '6.3': '8.1',
          '6.2': '8',
          '6.1': '7',
        };
        const friendly = ntToFriendly[win[1]] ?? win[1];
        detected = `Windows ${friendly}`;
      } else if (/Linux/i.test(ua)) {
        detected = 'Linux';
      } else if (ua) {
        detected = ua.length > 80 ? ua.slice(0, 80) : ua;
      }
    }
  } catch (err) {
    console.warn('[eventReportService] OS detection failed:', err);
  }

  cachedOsVersion = detected;
  return detected;
}

async function resolveDeviceId(): Promise<string> {
  const cached = deviceIdService.getCached();
  if (cached) return cached;
  try {
    return await deviceIdService.get();
  } catch {
    return '';
  }
}

function getDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget event report. Resolves the moment the request is
 * sent (or skipped); never rejects.
 *
 * `value` is optional. Pass it for events that carry extra context
 * (e.g. order ID, plan name); leave undefined and the body sends "".
 */
export async function reportEvent(
  name: EventName,
  value?: string,
): Promise<void> {
  try {
    const [appVersion, deviceId] = await Promise.all([
      resolveAppVersion(),
      resolveDeviceId(),
    ]);

    const body: ReportEventBody = {
      app_version: appVersion,
      device_id: deviceId,
      // Server expects an `int` so seconds, not milliseconds.
      event_time: Math.floor(Date.now() / 1000),
      name,
      os_version: detectOsVersion(),
      value: value ?? '',
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = getDeviceToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (deviceId) headers['X-Device-Id'] = deviceId;

    const baseUrl = EVENTS_BASE_URL.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/events`;

    await tauriHttpClient.post(endpoint, body, {
      headers,
      responseType: 'json',
      timeout: 15000,
      // Quiet mode — telemetry shouldn't surface error toasts.
      suppressErrorToast: true,
    });
  } catch (err) {
    // Swallow — analytics must NEVER disrupt the user flow.
    console.warn(`[eventReportService] reportEvent("${name}") failed:`, err);
  }
}

/** Synchronous trigger that doesn't return a promise. */
export function trackEvent(name: EventName, value?: string): void {
  void reportEvent(name, value);
}
