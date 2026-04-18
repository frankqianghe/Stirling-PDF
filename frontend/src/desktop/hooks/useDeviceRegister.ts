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

      // Post-register: ask the server whether to show the paywall ad.
      if (reg) {
        const ad = await adService.fetchAd();
        if (cancelled) return;

        if (ad && ad.adUrl && ad.adUrl.trim().length > 0) {
          console.log(
            `[useDeviceRegister] 📣 ad_url is non-empty, opening paywall: ${ad.adUrl}`
          );
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
