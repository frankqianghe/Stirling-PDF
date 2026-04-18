/**
 * useDesktopLicenseStatus
 *
 * Reads the desktop VIP / paid-license status from deviceRegisterService.
 *
 * On first render it returns the value persisted in localStorage from the
 * last successful /client/device/register call.  The value is updated
 * reactively once the current session's registration call resolves.
 *
 * paid_plan mapping:
 *   "free"     → isVip = false, plan = 'free'
 *   "year"     → isVip = true,  plan = 'year'
 *   "lifetime" → isVip = true,  plan = 'lifetime'
 */

import { useState, useEffect } from 'react';
import {
  deviceRegisterService,
  PaidPlan,
  DEVICE_PLAN_KEY,
  DEVICE_PLAN_EXPIRES_KEY,
} from '../services/deviceRegisterService';

export interface DesktopLicenseInfo {
  /** Whether the user has an active paid VIP license. */
  isVip: boolean;
  /** The raw plan identifier returned by the server. */
  plan: PaidPlan;
  /** Yearly plan expiry time (ISO), null for free/lifetime or unknown. */
  planExpiresAt: string | null;
  /** Whether the license status is still being resolved remotely. */
  loading: boolean;
}

export function useDesktopLicenseStatus(): DesktopLicenseInfo {
  // Read the last-known plan from localStorage immediately (synchronous)
  const [plan, setPlan] = useState<PaidPlan>(() => deviceRegisterService.getCachedPlan());
  const [planExpiresAt, setPlanExpiresAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DEVICE_PLAN_EXPIRES_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  // Subscribe to storage changes so multiple tabs / windows stay in sync
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === DEVICE_PLAN_KEY) {
        setPlan(deviceRegisterService.getCachedPlan());
      }
      if (e.key === DEVICE_PLAN_EXPIRES_KEY) {
        setPlanExpiresAt(e.newValue || null);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Listen for in-process license updates (storage events don't fire in the
  // same window, so we use a CustomEvent to broadcast license refreshes).
  useEffect(() => {
    const handleUpdate = () => {
      setPlan(deviceRegisterService.getCachedPlan());
      try {
        setPlanExpiresAt(localStorage.getItem(DEVICE_PLAN_EXPIRES_KEY));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('plexpdf-license-updated', handleUpdate);
    return () => window.removeEventListener('plexpdf-license-updated', handleUpdate);
  }, []);

  // Wait for the current registration call to finish and update state
  useEffect(() => {
    let cancelled = false;

    deviceRegisterService.register().then((reg) => {
      if (!cancelled) {
        if (reg !== null) {
          setPlan(reg.paidPlan);
          setPlanExpiresAt(reg.planExpiresAt || null);
        }
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, []);

  const isVip = plan === 'year' || plan === 'lifetime';

  return { isVip, plan, planExpiresAt, loading };
}
