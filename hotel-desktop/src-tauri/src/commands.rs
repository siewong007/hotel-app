//! Tauri commands for the Hotel Desktop application

use crate::AppState;

/// Tauri command to get the API server URL
#[tauri::command]
pub async fn get_api_url(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let server = state.server.lock().await;
    match server.as_ref() {
        Some(s) => Ok(s.base_url()),
        None => Err("Server not started".to_string()),
    }
}

/// Tauri command to check server health
#[tauri::command]
pub async fn check_server_health(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let server = state.server.lock().await;
    match server.as_ref() {
        Some(s) => {
            let url = format!("{}/health", s.base_url());
            match reqwest::get(&url).await {
                Ok(resp) => Ok(resp.status().is_success()),
                Err(_) => Ok(false),
            }
        }
        None => Err("Server not started".to_string()),
    }
}

/// Tauri command to get database status
#[tauri::command]
pub async fn get_database_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db = state.database.lock().await;
    match db.as_ref() {
        Some(_) => Ok("running".to_string()),
        None => Ok("stopped".to_string()),
    }
}
