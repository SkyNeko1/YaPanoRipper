//! Network utilities: public IP, internet check, Yandex reachability.
use std::net::ToSocketAddrs;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(5);

fn client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .ok()
}

/// Generic connectivity check via DNS — same approach as Python reference.
pub fn is_internet_alive() -> bool {
    for host in &["yandex.ru:443", "ya.ru:443", "1.1.1.1:443"] {
        if host.to_socket_addrs().is_ok() {
            return true;
        }
    }
    false
}

/// Walks ipify / icanhazip / ifconfig.me until one returns an IP.
pub fn get_public_ip() -> Option<String> {
    let c = client()?;
    let endpoints = [
        "https://api.ipify.org?format=json",
        "https://api64.ipify.org?format=json",
        "https://ifconfig.me/all.json",
    ];
    for url in endpoints {
        if let Ok(r) = c.get(url).send() {
            if r.status().is_success() {
                if let Ok(v) = r.json::<serde_json::Value>() {
                    let ip = v
                        .get("ip")
                        .and_then(|x| x.as_str())
                        .or_else(|| v.get("ip_addr").and_then(|x| x.as_str()));
                    if let Some(ip) = ip {
                        return Some(ip.to_string());
                    }
                }
            }
        }
    }
    None
}

/// HEAD request to yandex.ru — used to disambiguate "no internet" from "whitelist ISP".
pub fn is_yandex_reachable() -> bool {
    let Some(c) = client() else { return false; };
    c.head("https://yandex.ru").send().is_ok()
}
