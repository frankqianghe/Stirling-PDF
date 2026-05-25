/**
 * Frontend wrapper around the backend `GET /client/update/check` endpoint.
 *
 * Backend contract:
 *   Request:  GET /client/update/check?arch=win|mac|linux&version=X.Y.Z
 *   Response (no update):
 *     { "code": 0, "data": { "has_update": false } }
 *   Response (update available):
 *     {
 *       "code": 0,
 *       "data": {
 *         "has_update": true,
 *         "version": {
 *           "download_url": "string",
 *           "notes":        "string",
 *           "version":      "string"
 *         }
 *       },
 *       "message": "string"
 *     }
 *
 * The previous implementation hit the public GitHub releases API; we now
 * route through our own update server so the publisher controls release
 * gating, rollout windows, per-arch download URLs, and release notes.
 */

import tauriHttpClient from './tauriHttpClient';
import { getApiBaseUrl } from '@app/services/apiBaseUrl';

/**
 * Architecture short codes accepted by the update server.
 * The backend only branches on the OS family, not on the bitness or
 * cpu architecture, so we pass `win` / `mac` / `linux` rather than
 * something more granular like `x86_64-pc-windows-msvc`.
 */
export type UpdateArch = 'win' | 'mac' | 'linux';

interface UpdateCheckResponse {
  code: number;
  message?: string;
  data: {
    has_update: boolean;
    version?: {
      download_url?: string;
      notes?: string;
      version?: string;
    } | null;
  };
}

export interface UpdateInfo {
  version: string;
  downloadUrl: string;
  notes: string;
}

export type UpdateCheckResult =
  | { hasUpdate: false }
  | { hasUpdate: true; info: UpdateInfo };

/**
 * Returns the `arch` short code the update server expects.
 *
 * We deliberately avoid pulling in `@tauri-apps/plugin-os` (extra native
 * dependency for one string) and instead derive the family from the
 * webview's `navigator.userAgent`, which on Tauri reflects the host OS
 * faithfully:
 *   • Tauri/WebView2 on Windows  → contains "Windows"
 *   • Tauri/WKWebView on macOS   → contains "Mac OS X"
 *   • Tauri/WebKitGTK on Linux   → contains "Linux"
 *
 * Defaults to `'win'` because the desktop app currently ships
 * Windows-only releases — sending `win` to the update server is the
 * least surprising fallback if detection ever fails.
 */
export function detectUpdateArch(): UpdateArch {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Windows/i.test(ua)) return 'win';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
    if (/Linux/i.test(ua)) return 'linux';
  } catch {
    // fall through to the Windows default
  }
  return 'win';
}

class UpdateCheckService {
  /**
   * Calls `GET /client/update/check` and normalizes the response into
   * a discriminated union the UI layer can render directly.
   *
   * Throws on transport errors or non-zero `code` — the caller should
   * surface a user-visible error in those cases.
   */
  async check(currentVersion: string, arch?: UpdateArch): Promise<UpdateCheckResult> {
    const resolvedArch = arch ?? detectUpdateArch();
    const baseUrl = getApiBaseUrl().replace(/\/+$/, '');

    const params = new URLSearchParams({
      arch: resolvedArch,
      version: currentVersion,
    });
    const endpoint = `${baseUrl}/client/update/check?${params.toString()}`;

    const response = await tauriHttpClient.get<UpdateCheckResponse>(endpoint, {
      headers: { Accept: 'application/json' },
      responseType: 'json',
      timeout: 15000,
    });

    const json = response.data;
    if (!json || typeof json !== 'object') {
      throw new Error('Empty response from update server');
    }
    if (json.code !== 0) {
      const message = json.message || `Update check failed (code=${json.code})`;
      throw new Error(message);
    }

    if (!json.data || json.data.has_update !== true) {
      return { hasUpdate: false };
    }

    const v = json.data.version || {};
    const versionStr = (v.version || '').trim();
    const downloadUrl = (v.download_url || '').trim();
    if (!versionStr || !downloadUrl) {
      // Server claimed has_update=true but didn't provide enough metadata
      // to actually download. Treat this as a transport-level failure so
      // the user sees a clear error rather than a useless "Download"
      // button that points nowhere.
      throw new Error(
        'Update server reported an update but did not include a download URL.',
      );
    }

    return {
      hasUpdate: true,
      info: {
        version: versionStr,
        downloadUrl,
        notes: (v.notes || '').trim(),
      },
    };
  }
}

export const updateCheckService = new UpdateCheckService();
