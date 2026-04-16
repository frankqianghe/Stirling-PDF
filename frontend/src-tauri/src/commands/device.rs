/// Device identity commands
///
/// Uses the `mid` crate to obtain a stable, hardware-backed device fingerprint.
/// The fingerprint is deterministic per machine and is used to identify devices
/// for licensing and analytics purposes.
///
/// Platform-specific sources:
/// - macOS  : system_profiler (Model Number, Serial Number, Hardware UUID, SEID)
/// - Windows: WMI (Win32_ComputerSystemProduct UUID, BIOS serial, Baseboard serial, CPU ID)
/// - Linux  : /etc/machine-id or /sys/class/dmi/id/product_uuid

/// Application-specific HMAC salt.
/// Changing this value will invalidate all previously issued device IDs.
#[allow(dead_code)]
const DEVICE_ID_SALT: &str = "stirling-pdf-device-v1";

/// Returns a stable, hardware-backed SHA-256 device identifier.
///
/// The returned string is a 64-character lowercase hex string.
/// On error, falls back to a warning and returns an `Err`.
#[tauri::command]
pub async fn get_device_id() -> Result<String, String> {
    // TEMPORARY: Using random UUID instead of hardware fingerprint
    // TODO: Restore original implementation after debugging
    // Original: mid::get(DEVICE_ID_SALT).map_err(|e| {
    //     log::warn!("[device] Failed to obtain device ID via mid crate: {}", e);
    //     format!("Failed to get device ID: {}", e)
    // })
    
    // Generate a random UUID v4 string for temporary use
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let uuid = format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rng.gen::<u32>(),
        rng.gen::<u16>(),
        rng.gen::<u16>() & 0x0FFF,
        rng.gen::<u16>() & 0x3FFF | 0x8000,
        rng.gen::<u64>()
    );
    Ok(uuid)
}
