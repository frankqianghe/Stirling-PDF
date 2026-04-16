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

#[tauri::command]
pub async fn open_checkout_webview(
    app: AppHandle,
    url: String,
    order_id: Option<String>,
) -> Result<(), String> {
    let toolbar_label = "checkout-toolbar";
    let content_label = "checkout-webview";

    if let Some(existing) = app.get_webview_window(toolbar_label) {
        let _ = existing.close();
    }
    if let Some(existing) = app.get_webview_window(content_label) {
        let _ = existing.close();
    }

    let external_url = if url.starts_with("http://") || url.starts_with("https://") {
        WebviewUrl::External(url.parse().map_err(|e| format!("Invalid checkout URL: {}", e))?)
    } else {
        return Err("Checkout URL must be absolute http/https URL".to_string());
    };

    let toolbar_asset = match &order_id {
        Some(order) => format!("checkout-toolbar.html?order_id={}", order),
        None => "checkout-toolbar.html".to_string(),
    };

    let toolbar = WebviewWindowBuilder::new(&app, toolbar_label, WebviewUrl::App(toolbar_asset.into()))
        .title("Checkout Controls")
        .inner_size(1120.0, 56.0)
        .min_inner_size(860.0, 56.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .center()
        .build()
        .map_err(|e| format!("Failed to open checkout toolbar: {}", e))?;

    let toolbar_pos = toolbar
        .outer_position()
        .map_err(|e| format!("Failed to read checkout toolbar position: {}", e))?;

    let content_y = toolbar_pos.y as f64 + 56.0;
    let content_x = toolbar_pos.x as f64;

    WebviewWindowBuilder::new(&app, content_label, external_url)
        .title("Checkout")
        .inner_size(1120.0, 704.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .position(content_x, content_y)
        .build()
        .map_err(|e| format!("Failed to open checkout webview: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn close_checkout_webview(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("checkout-webview") {
        let _ = win.close();
    }
    if let Some(win) = app.get_webview_window("checkout-toolbar") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn checkout_back_to_status(app: AppHandle, order_id: Option<String>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("checkout-webview") {
        let _ = win.close();
    }
    if let Some(win) = app.get_webview_window("checkout-toolbar") {
        let _ = win.close();
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
        let _ = main.unminimize();
    }

    app.emit("checkout-back-to-status", order_id)
        .map_err(|e| format!("Failed to emit checkout-back-to-status event: {}", e))?;

    Ok(())
}
