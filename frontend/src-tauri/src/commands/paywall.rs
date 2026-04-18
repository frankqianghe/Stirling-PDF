use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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

    WebviewWindowBuilder::new(&app, label, external_url)
        .title("Checkout")
        .inner_size(1120.0, 760.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .center()
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
