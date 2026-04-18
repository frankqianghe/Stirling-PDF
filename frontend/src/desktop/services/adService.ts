/**
 * adService
 *
 * Calls GET /client/ad to ask the server whether an ad / paywall should be
 * shown right after device registration. Uses the same auth scheme as the
 * order endpoint: `Authorization: Bearer <token>` + `X-Device-Id: <id>`.
 *
 * Response shape:
 *   { code: 0, data: { ad_id: string, ad_url: string }, message: string }
 *
 * `ad_url` may be an empty string — in that case the caller should do nothing.
 */

import tauriHttpClient from './tauriHttpClient';
import { DEVICE_TOKEN_KEY } from './deviceRegisterService';
import { deviceIdService } from './deviceIdService';

const AD_SERVER_URL = 'https://plexpdf-test.wenxstudio.ai';

export interface AdInfo {
  adId: string;
  adUrl: string;
}

interface AdResponse {
  code: number;
  message: string;
  data: {
    ad_id?: string;
    ad_url?: string;
  };
}

class AdService {
  /**
   * Fetches the current ad / paywall trigger from the server.
   * Returns `null` on network or auth error — callers should treat that as
   * "no ad to show".
   */
  async fetchAd(): Promise<AdInfo | null> {
    const token = this.getDeviceToken();
    if (!token) {
      console.warn('[AdService] Skipping /client/ad: no device token available');
      return null;
    }

    const deviceId =
      deviceIdService.getCached() ?? (await deviceIdService.get());

    const baseUrl = AD_SERVER_URL.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/client/ad`;

    console.log('[AdService] GET /client/ad:', {
      endpoint,
      deviceId,
      tokenPrefix: `${token.slice(0, 16)}...`,
    });

    try {
      const response = await tauriHttpClient.get<AdResponse>(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Device-Id': deviceId,
        },
        responseType: 'json',
        timeout: 30000,
      });

      const json = response.data;
      console.log('[AdService] Raw /client/ad response:', JSON.stringify(json, null, 2));

      if (json.code !== 0) {
        console.warn(
          `[AdService] Server returned non-zero code ${json.code}: ${json.message}`
        );
        return null;
      }

      return {
        adId: json.data.ad_id ?? '',
        adUrl: json.data.ad_url ?? '',
      };
    } catch (err) {
      const errAny = err as any;
      console.error('[AdService] /client/ad failed:', {
        message: errAny?.message,
        code: errAny?.code,
        status: errAny?.status,
        responseData: errAny?.response?.data,
        raw: err,
      });
      return null;
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

export const adService = new AdService();
