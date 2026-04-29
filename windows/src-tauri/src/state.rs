//! Persistent state in %APPDATA%/YaPanoRipper/state.json
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct PersistedState {
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub ua: Option<String>,
    #[serde(default)]
    pub ua_source: Option<String>,
    #[serde(default)]
    pub ua_pools: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub ua_pools_updated_at: Option<f64>,
}

pub fn state_path() -> PathBuf {
    // dirs::data_dir() returns %APPDATA%\Roaming on Windows.
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    base.join("YaPanoRipper").join("state.json")
}

pub fn load() -> PersistedState {
    match std::fs::read_to_string(state_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => PersistedState::default(),
    }
}

pub fn save(s: &PersistedState) -> std::io::Result<()> {
    let p = state_path();
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".to_string());
    std::fs::write(&p, json)
}

pub fn reset() {
    let _ = std::fs::remove_file(state_path());
}
