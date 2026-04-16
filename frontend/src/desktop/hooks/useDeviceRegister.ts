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

    deviceRegisterService.registerWithRetry(10, 1200).then((reg) => {
      if (!cancelled) {
        setRegistration(reg);
        setRegistering(false);
      }
    });

    return () => { cancelled = true; };
  }, []);

  return { registration, registering };
}
