//! Tauri entry point + command handlers.
mod app_state;
mod network;
mod state;
mod ua_pool;

use app_state::AppState;
use std::thread;
use tauri::Manager;

#[tauri::command]
fn get_status(state: tauri::State<AppState>) -> serde_json::Value {
    state.get_status()
}

#[tauri::command]
fn force_update(state: tauri::State<AppState>) {
    state.force_update_pools();
}

#[tauri::command]
fn reset_app(state: tauri::State<AppState>) {
    state.reset();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .manage(app_state.clone())
        .invoke_handler(tauri::generate_handler![get_status, force_update, reset_app])
        .setup(move |app| {
            // Kick off boot sequence in a background thread.
            let st = app_state.clone();
            thread::spawn(move || st.startup());

            // Make sure the main window is maximized on first show.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.maximize();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
