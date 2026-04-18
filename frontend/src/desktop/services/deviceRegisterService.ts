/**
 * deviceRegisterService
 *
 * Registers this device with the PlexPDF backend on every app launch by
 * calling POST /client/device/register.
 *
 * The response contains:
 *   - token       : a device-scoped JWT that identifies the device
 *   - paid_plan   : "free" | "year" | "yearly" | "lifetime" | "buyout"
 *                   ("buyout" is a server-side alias for a one-time lifetime
 *                    purchase; both map to the internal PaidPlan `'lifetime'`)
 *   - plan_expires_at : ISO date string (for yearly plans)
 *
 * Both values are persisted in localStorage so other services (e.g.
 * useDesktopLicenseStatus) can read them synchronously without waiting for
 * the next registration call.
 */

import { deviceIdService } from './deviceIdService';
import tauriHttpClient from './tauriHttpClient';

// ── Storage keys ─────────────────────────────────────────────────────────────
export const DEVICE_TOKEN_KEY = 'plexpdf_device_token';
export const DEVICE_PLAN_KEY  = 'plexpdf_device_plan';
export const DEVICE_PLAN_EXPIRES_KEY = 'plexpdf_device_plan_expires';

// ── Types ─────────────────────────────────────────────────────────────────────
export type PaidPlan = 'free' | 'year' | 'lifetime';

export interface DeviceRegistration {
  token: string;
  paidPlan: PaidPlan;
  planExpiresAt: string | null;
}

// Fixed remote server for device registration (provided by product/dev team)
const DEVICE_REGISTER_SERVER_URL = 'https://plexpdf-test.wenxstudio.ai';

interface RegisterResponse {
  code: number;
  message: string;
  data: {
    paid_plan: string;
    plan_expires_at: string;
    token: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a human-readable OS version string derived from navigator.userAgent */
function getOsVersion(): string {
  const ua = navigator.userAgent;

  // macOS
  const mac = ua.match(/Mac OS X ([\d_]+)/);
  if (mac) return `macOS ${mac[1].replace(/_/g, '.')}`;

  // Windows
  const win = ua.match(/Windows NT ([\d.]+)/);
  if (win) {
    const ver: Record<string, string> = {
      '10.0': 'Windows 10/11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
    };
    return ver[win[1]] ?? `Windows NT ${win[1]}`;
  }

  // Linux
  const linux = ua.match(/Linux ([^;)]+)/);
  if (linux) return `Linux ${linux[1]}`;

  return 'Unknown OS';
}

/** Persist registration result to localStorage */
function persist(reg: DeviceRegistration): void {
  try {
    localStorage.setItem(DEVICE_TOKEN_KEY, reg.token);
    localStorage.setItem(DEVICE_PLAN_KEY,  reg.paidPlan);
    if (reg.planExpiresAt) {
      localStorage.setItem(DEVICE_PLAN_EXPIRES_KEY, reg.planExpiresAt);
    } else {
      localStorage.removeItem(DEVICE_PLAN_EXPIRES_KEY);
    }
  } catch {
    // Ignore write failures (e.g., private browsing storage limits)
  }
}

// ── Service ────────────────────────────────────────────────────────────────────

class DeviceRegisterService {
  /** Singleton in-flight promise – prevents duplicate registration calls on startup */
  private _promise: Promise<DeviceRegistration | null> | null = null;

  /**
   * Registers the device once.
   * If the call fails, `_promise` is reset so future calls can retry.
   */
  async register(): Promise<DeviceRegistration | null> {
    if (this._promise !== null) return this._promise;

    this._promise = this._doRegister()
      .then((res) => res)
      .catch((err) => {
        console.warn('[DeviceRegisterService] Registration failed:', err);
        return null;
      })
      .finally(() => {
        // IMPORTANT: allow future retry attempts after this run completes
        this._promise = null;
      });

    return this._promise;
  }

  /**
   * Register with retry for startup race conditions.
   * Useful when backend port is assigned but backend is still booting.
   */
  async registerWithRetry(maxAttempts = 8, delayMs = 1000): Promise<DeviceRegistration | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      console.log(
        `[DeviceRegisterService] 🔁 attempt ${attempt}/${maxAttempts}`
      );
      const res = await this.register();
      if (res !== null) {
        console.log(
          `[DeviceRegisterService] ✅ succeeded on attempt ${attempt}/${maxAttempts}`
        );
        return res;
      }

      if (attempt < maxAttempts) {
        console.log(
          `[DeviceRegisterService] ⏳ attempt ${attempt} failed, waiting ${delayMs}ms before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        console.error(
          `[DeviceRegisterService] ❌ giving up after ${maxAttempts} attempts`
        );
      }
    }

    return null;
  }

  /** Read the persisted plan synchronously (may be stale until register() resolves). */
  getCachedPlan(): PaidPlan {
    try {
      const raw = localStorage.getItem(DEVICE_PLAN_KEY);
      if (raw === 'year' || raw === 'lifetime') return raw;
    } catch { /* ignore */ }
    return 'free';
  }

  /** Read the persisted device token synchronously. */
  getCachedToken(): string | null {
    try {
      return localStorage.getItem(DEVICE_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _doRegister(): Promise<DeviceRegistration> {
    // Ensure device ID is resolved first
    const deviceId = await deviceIdService.get();
    const osVersion = getOsVersion();

    // Always use the fixed remote server for device registration.
    // This endpoint must not depend on local Java backend routing.
    const baseUrl = DEVICE_REGISTER_SERVER_URL.replace(/\/+$/, '');

    const payload = {
      device_id: deviceId,
      motherboard_serial: deviceId,
      os_version: osVersion,
      system_drive_serial: deviceId,
    };

    console.log('[DeviceRegisterService] Registering device payload:', {
      ...payload,
      endpoint: `${baseUrl}/client/device/register`,
      fixed_server: DEVICE_REGISTER_SERVER_URL,
    });

    let responseStatus = 0;
    let responseStatusText = '';
    let json: RegisterResponse;

    try {
      const response = await tauriHttpClient.post<RegisterResponse>(
        `${baseUrl}/client/device/register`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Id': deviceId,
          },
          responseType: 'json',
          timeout: 30000,
        }
      );

      responseStatus = response.status;
      responseStatusText = response.statusText;
      json = response.data;
    } catch (networkErr) {
      const errAny = networkErr as any;
      console.error(
        '[DeviceRegisterService] ❌ Network/HTTP error during /client/device/register:',
        {
          message: errAny?.message,
          code: errAny?.code,
          status: errAny?.status,
          responseData: errAny?.response?.data,
          raw: networkErr,
        }
      );
      throw networkErr;
    }

    console.log('[DeviceRegisterService] HTTP status:', responseStatus, responseStatusText);

    console.log('[DeviceRegisterService] Raw response:', JSON.stringify(json, null, 2));

    if (json.code !== 0) {
      console.error('[DeviceRegisterService] ❌ Server returned error:', json.code, json.message);
      throw new Error(`Device registration error: ${json.message}`);
    }

    const rawPlan = (json.data.paid_plan ?? '').toLowerCase();
    const paidPlan: PaidPlan =
      rawPlan === 'year' || rawPlan === 'yearly' ? 'year'
      : rawPlan === 'lifetime' || rawPlan === 'buyout' ? 'lifetime'
      : 'free';

    const reg: DeviceRegistration = {
      token: json.data.token,
      paidPlan,
      planExpiresAt: json.data.plan_expires_at || null,
    };

    persist(reg);
    console.log('[DeviceRegisterService] ✅ Registered. plan:', paidPlan, '| token:', reg.token.slice(0, 16) + '...');
    return reg;
  }

}

export const deviceRegisterService = new DeviceRegisterService();
