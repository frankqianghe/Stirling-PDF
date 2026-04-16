/**
 * Device ID Service
 *
 * Fetches a stable, hardware-backed device identifier via the `get_device_id`
 * Tauri command (backed by the `mid` Rust crate).
 *
 * The result is cached in-process after the first successful call so that
 * every API request interceptor can access it synchronously via
 * `deviceIdService.getCached()`, or asynchronously via `deviceIdService.get()`.
 *
 * Initialise early in the app lifecycle by calling `deviceIdService.init()`.
 */

import { invoke } from '@tauri-apps/api/core';

const FALLBACK_KEY = 'stirling_device_id_fallback';

class DeviceIdService {
  /** In-memory cache – populated on first successful resolution */
  private _cached: string | null = null;

  /** Singleton promise so concurrent callers share the same IPC call */
  private _promise: Promise<string> | null = null;

  /**
   * Initialise the service.
   * Should be called once during app startup (before the first API request).
   * Safe to call multiple times – subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this._cached !== null) return;
    await this.get();
  }

  /**
   * Returns the device ID, fetching it from Rust if not yet cached.
   * Never throws – falls back to a localStorage-persisted UUID on error.
   */
  async get(): Promise<string> {
    if (this._cached !== null) return this._cached;

    if (this._promise === null) {
      this._promise = this._fetch().finally(() => {
        // Allow retry if the promise was rejected (e.g., on first cold start)
        this._promise = null;
      });
    }

    return this._promise;
  }

  /**
   * Returns the cached device ID synchronously.
   * Returns `null` if `init()` / `get()` has not yet resolved.
   */
  getCached(): string | null {
    return this._cached;
  }

  // ---------- private ----------

  private async _fetch(): Promise<string> {
    try {
      const id = await invoke<string>('get_device_id');
      if (id && id.length > 0) {
        this._cached = id;
        console.log('[DeviceIdService] ✅ Device ID obtained from hardware:', id);
        return id;
      }
      throw new Error('Empty device ID returned');
    } catch (err) {
      console.warn('[DeviceIdService] Failed to get hardware device ID, using fallback:', err);
      const fallback = this._getFallback();
      this._cached = fallback;
      return fallback;
    }
  }

  /**
   * Persist a randomly-generated fallback ID in localStorage.
   * This is used when the Rust command is unavailable (e.g., dev browser mode).
   */
  private _getFallback(): string {
    try {
      let id = localStorage.getItem(FALLBACK_KEY);
      if (!id) {
        id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(FALLBACK_KEY, id);
      }
      return id;
    } catch {
      return `fallback-${Date.now()}`;
    }
  }
}

export const deviceIdService = new DeviceIdService();
