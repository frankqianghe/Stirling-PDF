use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri::webview::PageLoadEvent;

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

    WebviewWindowBuilder::new(&app, label, external_url)
        .title("Checkout")
        .inner_size(1120.0, 760.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .closable(true)
        .decorations(true)
        .center()
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

    // Some checkout providers (Lemon Squeezy in particular) register a
    // `beforeunload` handler.  On Windows + WebView2, that hook can
    // visibly hang the native title-bar X button: the OS fires
    // `WM_CLOSE`, the runtime emits `CloseRequested`, and the webview
    // sits there waiting for a confirm dialog the user never sees.
    //
    // We sidestep that by force-destroying the window the moment
    // `CloseRequested` fires — `destroy()` is the documented "skip
    // beforeunload" escape hatch.  We also still emit the
    // `checkout-payment-success` event listener path independently
    // (via `on_navigation` above), so this handler only fires for
    // user-initiated closes.
    if let Some(win) = app.get_webview_window(label) {
        let app_for_close = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                log::info!(
                    "[paywall] checkout webview CloseRequested — force destroying"
                );
                // Prevent the default close-with-beforeunload path so
                // the runtime doesn't sit waiting for a JS confirm
                // dialog the user can't see/answer, then synchronously
                // destroy the window to make the X button feel snappy.
                api.prevent_close();
                if let Some(w) = app_for_close.get_webview_window("checkout-webview") {
                    let _ = w.destroy();
                }
            }
        });
    }

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
