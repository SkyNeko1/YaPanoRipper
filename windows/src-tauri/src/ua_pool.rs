//! User-Agent pool management.
//!
//! Mirrors the Python reference: fetch HyperBeats/User-Agent-List with
//! jsdelivr fallback, persist (IP, UA) pair so the same UA is reused per IP.
use rand::seq::SliceRandom;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::state::PersistedState;

const POOL_NAMES: [&str; 5] = ["android", "desktop", "ios", "macos", "linux"];
pub const POOL_TTL_SEC: f64 = 7.0 * 86400.0;

/// Embedded fallback pool — used when external sources are unreachable AND
/// the user has no saved UA yet. Sampled from HyperBeats/User-Agent-List.
const BUNDLED_UA_POOL: [&str; 30] = [
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.1661.45 Safari/537.36 Edg/111.0.1661.45",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.248 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.1) Gecko/20100101 Firefox/84.1",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.174 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:110.0.1) Gecko/20100101 Firefox/110.0.1",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.1020.63 Safari/537.36 Edg/95.0.1020.63",
    "Mozilla/5.0 (Windows NT 6.3; WOW64; rv:92.0) Gecko/20100101 Firefox/92.0",
    "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.818.86 Safari/537.36 Edg/90.0.818.86",
    "Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.58 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.902.29 Safari/537.36 Edg/92.0.902.29",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.1072.28 Safari/537.36 Edg/97.0.1072.28",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.146 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:88) Gecko/20100101 Firefox/88",
    "Mozilla/5.0 (Windows NT 6.2; WOW64; rv:87) Gecko/20100101 Firefox/87",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.131 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:95.0.1) Gecko/20100101 Firefox/95.0.1",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.5563.163 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:81.2) Gecko/20100101 Firefox/81.2",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:103.0.1) Gecko/20100101 Firefox/103.0.1",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.1264.69 Safari/537.36 Edg/103.0.1264.69",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.1343.5 Safari/537.36 Edg/105.0.1343.5",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.13 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.181 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.83 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.164 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.2; WOW64; rv:91.0.6) Gecko/20100101 Firefox/91.0.6",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:102.0.6) Gecko/20100101 Firefox/102.0.6",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.212 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:88.1) Gecko/20100101 Firefox/88.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.88 Safari/537.36",
];

fn pool_urls(name: &str) -> [String; 2] {
    [
        format!("https://raw.githubusercontent.com/HyperBeats/User-Agent-List/main/useragents-{name}.txt"),
        format!("https://cdn.jsdelivr.net/gh/HyperBeats/User-Agent-List@main/useragents-{name}.txt"),
    ]
}

fn is_valid_ua(value: &str) -> bool {
    (24..=512).contains(&value.len())
        && value.starts_with("Mozilla/5.0")
        && !value.chars().any(char::is_control)
}

fn fetch_one(name: &str) -> Option<Vec<String>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    for url in pool_urls(name) {
        if let Ok(r) = client.get(&url).send() {
            if r.status().is_success() {
                if let Ok(text) = r.text() {
                    let lines: Vec<String> = text
                        .lines()
                        .map(|l| l.trim().to_string())
                        .filter(|l| !l.is_empty() && !l.starts_with('#') && is_valid_ua(l))
                        .collect();
                    if !lines.is_empty() {
                        return Some(lines);
                    }
                }
            }
        }
    }
    None
}

pub fn fetch_all_pools() -> HashMap<String, Vec<String>> {
    let out = Mutex::new(HashMap::new());
    std::thread::scope(|scope| {
        for name in POOL_NAMES {
            let out = &out;
            scope.spawn(move || {
                if let Some(list) = fetch_one(name) {
                    if let Ok(mut pools) = out.lock() {
                        pools.insert(name.to_string(), list);
                    }
                }
            });
        }
    });
    out.into_inner().unwrap_or_default()
}

pub fn is_pool_stale(s: &PersistedState) -> bool {
    if s.ua_pools.is_empty() {
        return true;
    }
    let last = s.ua_pools_updated_at.unwrap_or(0.0);
    let now = now_secs();
    (now - last) > POOL_TTL_SEC
}

pub fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn pick_ua(pools: &HashMap<String, Vec<String>>) -> Option<String> {
    let flat: Vec<&String> = pools.values().flatten().collect();
    if flat.is_empty() {
        return None;
    }
    let mut rng = rand::thread_rng();
    flat.choose(&mut rng).map(|s| s.to_string())
}

/// Returns the UA to use for the current session.
///
/// Logic mirrors the Python reference:
///   - If current IP matches saved IP and a saved UA exists -> reuse it.
///   - Otherwise pick a new UA from the external pool, save (IP, UA).
///   - If external pool is empty -> use BUNDLED_UA_POOL, mark source="bundled".
pub fn get_or_assign_ua(state: &mut PersistedState, current_ip: Option<String>) -> String {
    if let (Some(cur), Some(saved_ip), Some(saved_ua)) = (&current_ip, &state.ip, &state.ua) {
        if cur == saved_ip {
            return saved_ua.clone();
        }
    }

    let (ua, source) = match pick_ua(&state.ua_pools) {
        Some(u) => (u, "external"),
        None => {
            let mut rng = rand::thread_rng();
            let u = BUNDLED_UA_POOL
                .choose(&mut rng)
                .copied()
                .unwrap_or(BUNDLED_UA_POOL[0])
                .to_string();
            (u, "bundled")
        }
    };

    state.ip = current_ip;
    state.ua = Some(ua.clone());
    state.ua_source = Some(source.to_string());
    ua
}
