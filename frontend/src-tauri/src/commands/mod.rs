pub mod backend;
pub mod files;
pub mod connection;
pub mod auth;
pub mod default_app;
pub mod device;
pub mod paywall;

pub use backend::{cleanup_backend, get_backend_port, start_backend};
pub use files::{add_opened_file, clear_opened_files, get_opened_files, pop_opened_files};
pub use connection::{
    get_connection_config,
    is_first_launch,
    reset_setup_completion,
    set_connection_mode,
};
pub use auth::{
    clear_auth_token,
    clear_refresh_token,
    clear_user_info,
    get_auth_token,
    get_refresh_token,
    get_user_info,
    login,
    save_auth_token,
    save_refresh_token,
    save_user_info,
    start_oauth_login,
};
pub use default_app::{is_default_pdf_handler, set_as_default_pdf_handler};
pub use device::get_device_id;
pub use paywall::{
    checkout_back_to_status,
    close_checkout_webview,
    close_paywall_window,
    open_checkout_webview,
    open_paywall_window,
};
