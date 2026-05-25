/**
 * apiBaseUrl
 *
 * Single source of truth for the PlexPDF remote API base URL used by every
 * desktop service (device register / activate, orders, ads, events, update
 * check, convert tasks, checkout redirect, …).
 *
 * Two environments are supported:
 *   - PROD : https://plexpdf.wenxstudio.ai           (official / release)
 *   - TEST : https://plexpdf-test.wenxstudio.ai      (staging / debugging)
 *
 * Switching at runtime
 * ────────────────────
 * The choice is persisted in localStorage under `plexpdf_debug_use_test_server`
 * and read on every call to {@link getApiBaseUrl}, so changes take effect on
 * the *next* HTTP request without needing a full app reload.
 *
 * For convenience the same controls are exposed on the global window object so
 * you can toggle from the browser / WebView2 dev-tools console:
 *
 *   __plexpdfApi.useTest()    // switch to https://plexpdf-test.wenxstudio.ai
 *   __plexpdfApi.useProd()    // switch back to https://plexpdf.wenxstudio.ai
 *   __plexpdfApi.getBase()    // current base URL
 *   __plexpdfApi.isTest()     // boolean
 *
 * After switching it is recommended to reload the window so cached services
 * (e.g. an in-flight device registration promise) re-issue against the new
 * host.
 *
 * Default
 * ───────
 * The default (when the localStorage key is unset) is {@link PROD_API_BASE_URL}
 * so end users hit the production host out of the box.  Flip
 * {@link DEFAULT_USE_TEST_SERVER} to `true` only for staging/QA builds.
 */

export const PROD_API_BASE_URL = 'https://plexpdf.wenxstudio.ai';
export const TEST_API_BASE_URL = 'https://plexpdf-test.wenxstudio.ai';

/** localStorage key that holds the debug toggle ("true" / "false"). */
export const DEBUG_USE_TEST_SERVER_KEY = 'plexpdf_debug_use_test_server';

/**
 * Fallback when the localStorage key is missing.  Keep aligned with whatever
 * the *shipping* default should be at any given time.
 */
const DEFAULT_USE_TEST_SERVER = false;

function readDebugFlag(): boolean {
  try {
    const raw = localStorage.getItem(DEBUG_USE_TEST_SERVER_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* localStorage may be unavailable (SSR, private mode, …) */
  }
  return DEFAULT_USE_TEST_SERVER;
}

/** Returns true when the test server is currently selected. */
export function isUsingTestServer(): boolean {
  return readDebugFlag();
}

/** Returns the base URL that all remote services should use right now. */
export function getApiBaseUrl(): string {
  return readDebugFlag() ? TEST_API_BASE_URL : PROD_API_BASE_URL;
}

/**
 * Persist the debug flag.  Pass `null` (or `undefined`) to clear the override
 * and fall back to {@link DEFAULT_USE_TEST_SERVER}.
 */
export function setUseTestServer(useTest: boolean | null | undefined): void {
  try {
    if (useTest === null || useTest === undefined) {
      localStorage.removeItem(DEBUG_USE_TEST_SERVER_KEY);
    } else {
      localStorage.setItem(DEBUG_USE_TEST_SERVER_KEY, useTest ? 'true' : 'false');
    }
    // eslint-disable-next-line no-console
    console.info(
      `[apiBaseUrl] API base is now ${getApiBaseUrl()} ` +
      `(useTest=${isUsingTestServer()}). Reload the window so in-flight ` +
      `singletons (deviceRegister, etc.) pick up the change.`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[apiBaseUrl] Failed to persist debug toggle:', err);
  }
}

// ── Console / dev-tools helper ────────────────────────────────────────────────
// Exposes a tiny object on `window` so QA and devs can flip environments from
// the browser console without rebuilding.  Safe to call repeatedly: idempotent.
if (typeof window !== 'undefined') {
  (window as unknown as { __plexpdfApi?: unknown }).__plexpdfApi = {
    PROD: PROD_API_BASE_URL,
    TEST: TEST_API_BASE_URL,
    getBase: getApiBaseUrl,
    isTest: isUsingTestServer,
    useTest: () => setUseTestServer(true),
    useProd: () => setUseTestServer(false),
    reset:   () => setUseTestServer(null),
  };
}
