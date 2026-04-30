/**
 * useDeviceRegister
 *
 * Calls deviceRegisterService.register() once per app session (on mount).
 * Should be rendered inside AppProviders after the backend is ready.
 *
 * Exposes the latest registration result so components can react to
 * plan changes discovered at startup.
 */

import { useEffect, useState } from 'react';
import {
  deviceRegisterService,
  DeviceRegistration,
} from '../services/deviceRegisterService';
import { adService } from '../services/adService';
import { trackEvent } from '../services/eventReportService';

export interface UseDeviceRegisterResult {
  registration: DeviceRegistration | null;
  /** true while the first registration call is in flight */
  registering: boolean;
}

export function useDeviceRegister(): UseDeviceRegisterResult {
  const [registration, setRegistration] = useState<DeviceRegistration | null>(null);
  const [registering, setRegistering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    console.log('[useDeviceRegister] 🚀 starting registerWithRetry(10, 1200)');
    const startedAt = Date.now();

    deviceRegisterService.registerWithRetry(10, 1200).then(async (reg) => {
      const elapsed = Date.now() - startedAt;
      if (cancelled) return;

      if (reg) {
        console.log(
          `[useDeviceRegister] ✅ registration succeeded in ${elapsed}ms, plan=${reg.paidPlan}, token prefix=${reg.token.slice(0, 16)}...`
        );
      } else {
        console.error(
          `[useDeviceRegister] ❌ registration FAILED after all retries (${elapsed}ms). No device token will be available; any order / license API will return 401.`
        );
      }
      setRegistration(reg);
      setRegistering(false);

      // Broadcast a global "device registration done" event so anything
      // that started before registration completed (e.g. a Convert/OCR
      // submit clicked on the very first second of app startup) can
      // un-block itself.  Listeners — see `waitForDeviceRegistration` in
      // `core/services/taskService.ts` — only care that the round-trip
      // *resolved*, not whether it succeeded; on failure we still want
      // them to proceed and let the eventual API call surface a clean
      // 401 instead of leaving the submit button spinning forever.
      try {
        window.dispatchEvent(
          new CustomEvent('plexpdf-device-registered', {
            detail: {
              success: Boolean(reg),
              paidPlan: reg?.paidPlan ?? 'free',
            },
          }),
        );
      } catch (err) {
        console.warn(
          '[useDeviceRegister] failed to dispatch plexpdf-device-registered event:',
          err,
        );
      }

      // Post-register: ask the server whether to show the paywall ad.
      if (reg) {
        const ad = await adService.fetchAd();
        if (cancelled) return;

        if (ad && ad.adUrl && ad.adUrl.trim().length > 0) {
          console.log(
            `[useDeviceRegister] 📣 ad_url is non-empty, opening paywall: ${ad.adUrl}`
          );
          // Telemetry: free user auto-popup (post /client/ad, non-empty url)
          trackEvent('checkout_popup_show', ad.adId);
          window.dispatchEvent(
            new CustomEvent('plexpdf-open-paywall', {
              detail: { source: 'ad', adId: ad.adId, adUrl: ad.adUrl },
            })
          );
        } else {
          console.log(
            '[useDeviceRegister] ad_url is empty, no paywall will be shown'
          );
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { registration, registering };
}
