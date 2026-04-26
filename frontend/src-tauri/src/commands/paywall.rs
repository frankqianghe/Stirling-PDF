use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::PageLoadEvent;

/// Injected into every page loaded inside the checkout webview.
///
/// Lemon Squeezy (and many other hosted checkout providers) registers
/// `beforeunload` listeners.  On Windows + WebView2 those listeners cause the
/// native title-bar X button to visibly hang: WM_CLOSE fires, but the runtime
/// sits forever waiting for the JS confirm dialog the user can never see /
/// answer.  We pre-empt this by neutralising both `window.onbeforeunload`
/// assignments AND `addEventListener('beforeunload', ...)` registrations
/// before the host page's scripts run.  Same trick for `unload`, just to be
/// thorough.
///
/// Important: we deliberately do NOT add a Rust-side `on_window_event` /
/// `prevent_close()` handler — combining `prevent_close()` and `destroy()`
/// in the same closure on Windows leaves the runtime in a state where
/// subsequent CloseRequested events on the *main* window are silently
/// dropped, which is exactly the regression users reported.
const CHECKOUT_BEFOREUNLOAD_SUPPRESS_SCRIPT: &str = r#"
(function () {
  try {
    var SUPPRESSED = { beforeunload: true, unload: true };
    Object.defineProperty(window, 'onbeforeunload', {
      configurable: true,
      get: function () { return null; },
      set: function () { /* swallow */ }
    });
    Object.defineProperty(window, 'onunload', {
      configurable: true,
      get: function () { return null; },
      set: function () { /* swallow */ }
    });
    var origAdd = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type && SUPPRESSED[String(type).toLowerCase()]) {
        return; /* drop */
      }
      return origAdd.call(this, type, listener, options);
    };
  } catch (err) {
    /* logging doesn't matter — the worst case is a slightly slower close */
    try { console.warn('[plexpdf] beforeunload suppression failed', err); } catch (_) {}
  }
})();
"#;

/// Opens a dedicated in-app WebviewWindow that loads the paywall HTML page.
#[tauri::command]
pub async fn open_paywall_window(
    app: AppHandle,
    source: Option<String>,
    plan: Option<String>,
) -> Result<(), String> {
    let label = "paywall";

    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.set_focus();
        let _ = existing.unminimize();
        return Ok(());
    }

    let mut query_parts: Vec<String> = Vec::new();
    if let Some(s) = &source { query_parts.push(format!("source={}", s)); }
    if let Some(p) = &plan   { query_parts.push(format!("plan={}", p)); }

    let asset_path = if query_parts.is_empty() {
        "paywall.html".to_string()
    } else {
        format!("paywall.html?{}", query_parts.join("&"))
    };

    let url = WebviewUrl::App(asset_path.into());

    WebviewWindowBuilder::new(&app, label, url)
        .title("Upgrade to VIP")
        .inner_size(880.0, 680.0)
        .min_inner_size(660.0, 560.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("Failed to open paywall window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn close_paywall_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("paywall") {
        win.close().map_err(|e| format!("Failed to close paywall window: {}", e))?;
    }
    Ok(())
}

/// Opens a centered checkout webview.
///
/// The webview's navigation handler watches for the supplied `redirect_url`
/// prefix.  When the server redirects the page to that URL after a successful
/// payment, the navigation is cancelled, the webview window is closed and a
/// `checkout-payment-success` event is emitted to the main window so the
/// frontend can show a success panel.
#[tauri::command]
pub async fn open_checkout_webview(
    app: AppHandle,
    url: String,
    order_id: Option<String>,
    redirect_url: String,
) -> Result<(), String> {
    let label = "checkout-webview";

    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.close();
    }

    let external_url = if url.starts_with("http://") || url.starts_with("https://") {
        WebviewUrl::External(url.parse().map_err(|e| format!("Invalid checkout URL: {}", e))?)
    } else {
        return Err("Checkout URL must be absolute http/https URL".to_string());
    };

    let app_for_nav = app.clone();
    let redirect_prefix = redirect_url.clone();
    let order_for_nav = order_id.clone();
    let app_for_load = app.clone();
    let redirect_prefix_for_load = redirect_url.clone();

    // We deliberately match the latest stable Edge UA exactly.  Lemon
    // Squeezy / Cloudflare are aggressive about flagging anything that
    // looks like an embedded browser; while WebView2's default UA is
    // already very Edge-like, some Windows builds leak a `WebView2/`
    // suffix or stale Chrome version numbers, both of which can be
    // enough to push the Cloudflare risk score over the threshold and
    // trigger a JS challenge that the embedded view can't satisfy
    // (which presents to the user as a permanently blank page).
    //
    // The string here should be bumped along with new Edge stable
    // releases, but stale-by-a-minor-version is still much closer to a
    // real browser than the WebView2 default in some environments.
    const CHECKOUT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

    // Best-effort WebView2 tuning for hosted checkout pages:
    //   - autoplay-policy: lemonsqueezy occasionally embeds promo
    //     videos / audio that can stall the rest of the page if the
    //     WebView2 default policy gates them.
    //   - disable-features=msSmartScreenProtection: SmartScreen has
    //     historically delayed first paint on third-party domains.
    //   - disable-features=msImplicitSignin: prevents WebView2 from
    //     trying to silently sign the user in with their Windows
    //     account, which can race with the page's own auth.
    #[cfg(windows)]
    const CHECKOUT_BROWSER_ARGS: &str =
        "--autoplay-policy=no-user-gesture-required \
         --disable-features=msSmartScreenProtection,msImplicitSignin";

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, label, external_url)
        .title("Checkout")
        .inner_size(1120.0, 760.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .closable(true)
        .decorations(true)
        .center()
        .user_agent(CHECKOUT_USER_AGENT)
        .initialization_script(CHECKOUT_BEFOREUNLOAD_SUPPRESS_SCRIPT);

    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(CHECKOUT_BROWSER_ARGS);
    }

    builder
        // Forward checkout-webview page load completions to the main
        // window so the frontend can fire the
        // `lemonsqueezy_load_finished` analytics event when the
        // hosted checkout page is fully rendered.  We deliberately
        // skip the success-redirect URL — that one is intercepted
        // and cancelled in `on_navigation`, and we don't want a
        // duplicate "page loaded" event on the same flow.
        .on_page_load(move |_window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let url_str = payload.url().to_string();
                if url_str.starts_with(&redirect_prefix_for_load) {
                    return;
                }
                log::info!(
                    "[paywall] checkout webview page finished loading: {}",
                    url_str
                );
                let _ = app_for_load.emit(
                    "checkout-page-loaded",
                    CheckoutPageLoadedPayload { url: url_str },
                );
            }
        })
        .on_navigation(move |next_url| {
            let next_str = next_url.as_str();
            if next_str.starts_with(&redirect_prefix) {
                log::info!(
                    "[paywall] checkout webview hit redirect URL ({}), closing and notifying main window",
                    next_str
                );

                let app_h = app_for_nav.clone();
                let order_h = order_for_nav.clone();
                let url_str = next_str.to_string();

                tauri::async_runtime::spawn(async move {
                    if let Some(win) = app_h.get_webview_window("checkout-webview") {
                        let _ = win.close();
                    }
                    if let Some(main) = app_h.get_webview_window("main") {
                        let _ = main.set_focus();
                        let _ = main.unminimize();
                    }
                    let _ = app_h.emit(
                        "checkout-payment-success",
                        CheckoutSuccessPayload {
                            order_id: order_h,
                            redirect_url: url_str,
                        },
                    );
                });

                // Cancel the navigation so the webview doesn't attempt to
                // actually load the localhost URL (there is no server listening).
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("Failed to open checkout webview: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn close_checkout_webview(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("checkout-webview") {
        let _ = win.close();
    }
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct CheckoutSuccessPayload {
    order_id: Option<String>,
    redirect_url: String,
}

#[derive(Clone, serde::Serialize)]
struct CheckoutPageLoadedPayload {
    url: String,
}
