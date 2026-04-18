/**
 * licenseActivationService
 *
 * Handles manual license activation. The user pastes a License Key they
 * received in their purchase email, we hit `POST /client/device/activate`
 * on the PlexPDF server, and – on success – re-register the device so the
 * freshly-granted `paid_plan` is pushed into localStorage and broadcast to
 * the rest of the app.
 *
 * Server contract (both success and failure return HTTP 200 with `code: 0`;
 * they are distinguished by the shape of `data`):
 *
 *   SUCCESS:
 *     { code: 0, message: "...",
 *       data: { paid_plan: "year" | "lifetime" | ..., plan_expires_at: "..." } }
 *
 *   FAILURE (e.g. invalid key):
 *     { code: 0, message: "...", data: "some error string" }
 *
 * Any non-zero `code`, a string `data`, or a network/HTTP error is treated
 * as an invalid key and surfaced to the UI as a plain error.
 */

import tauriHttpClient from './tauriHttpClient';
import { deviceIdService } from './deviceIdService';
import { deviceRegisterService, DEVICE_TOKEN_KEY } from './deviceRegisterService';

const LICENSE_SERVER_URL = 'https://plexpdf-test.wenxstudio.ai';

interface ActivateResponse {
  code: number;
  message: string;
  // `data` can be either a success payload or an error string, per the
  // server contract described in the module-level docstring above.
  data?:
    | string
    | {
        paid_plan?: string;
        plan_expires_at?: string;
      };
}

export interface ActivateResult {
  ok: boolean;
  /** Server-provided message on failure; undefined on success. */
  errorMessage?: string;
}

class LicenseActivationService {
  async activate(planKey: string): Promise<ActivateResult> {
    const key = planKey.trim();
    if (!key) {
      return { ok: false, errorMessage: 'License key is empty.' };
    }

    const token = this.getDeviceToken();
    if (!token) {
      return {
        ok: false,
        errorMessage: 'Device is not registered yet. Please restart the app and try again.',
      };
    }

    const deviceId =
      deviceIdService.getCached() ?? (await deviceIdService.get());

    const baseUrl = LICENSE_SERVER_URL.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/client/device/activate`;

    console.log('[LicenseActivationService] POST /client/device/activate:', {
      endpoint,
      deviceId,
      tokenPrefix: `${token.slice(0, 16)}...`,
      keyPrefix: `${key.slice(0, 4)}...`,
    });

    try {
      const response = await tauriHttpClient.post<ActivateResponse>(
        endpoint,
        { plan_key: key },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Device-ID': deviceId,
          },
          responseType: 'json',
          timeout: 30000,
        }
      );

      const json = response.data;
      console.log(
        '[LicenseActivationService] Raw activate response:',
        JSON.stringify(json, null, 2)
      );

      const isSuccessPayload =
        json.code === 0 &&
        json.data !== null &&
        typeof json.data === 'object' &&
        typeof json.data.paid_plan === 'string' &&
        json.data.paid_plan.length > 0;

      if (!isSuccessPayload) {
        // Failure: server returned either a non-zero code OR a string `data`
        // field (the contract's invalid-key response).
        const serverMsg =
          (typeof json.data === 'string' && json.data) ||
          json.message ||
          'Invalid License Key.';
        return { ok: false, errorMessage: serverMsg };
      }

      // Refresh the cached plan by hitting /client/device/register again so
      // the rest of the app (useDesktopLicenseStatus, paywall pill, VIP
      // crown, …) reacts immediately.
      try {
        const reg = await deviceRegisterService.register();
        console.log(
          '[LicenseActivationService] License refreshed after activation, plan =',
          reg?.paidPlan
        );
      } catch (err) {
        console.warn(
          '[LicenseActivationService] Failed to refresh license after activation:',
          err
        );
      }
      window.dispatchEvent(new Event('plexpdf-license-updated'));

      return { ok: true };
    } catch (err) {
      const errAny = err as any;
      console.error('[LicenseActivationService] activate failed:', {
        message: errAny?.message,
        code: errAny?.code,
        status: errAny?.status,
        responseData: errAny?.response?.data,
        raw: err,
      });

      const respData = errAny?.response?.data;
      const serverMsg =
        (typeof respData === 'string' && respData) ||
        respData?.message ||
        (typeof respData?.data === 'string' && respData.data) ||
        errAny?.message ||
        'Invalid License Key.';
      return { ok: false, errorMessage: serverMsg };
    }
  }

  private getDeviceToken(): string | null {
    try {
      return localStorage.getItem(DEVICE_TOKEN_KEY);
    } catch {
      return null;
    }
  }
}

export const licenseActivationService = new LicenseActivationService();
