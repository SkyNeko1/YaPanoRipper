//! Network utilities: public IP, internet check, Yandex reachability.
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

fn client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .ok()
}

fn can_connect(host: &str) -> bool {
    match host.to_socket_addrs() {
        Ok(addrs) => addrs
            .into_iter()
            .any(|addr| TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).is_ok()),
        Err(_) => false,
    }
}

/// Generic connectivity check with a real TCP connect, not just DNS resolution.
pub fn is_internet_alive() -> bool {
    ["yandex.ru:443", "ya.ru:443", "1.1.1.1:443"]
        .iter()
        .any(|host| can_connect(host))
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
    let Some(c) = client() else {
        return false;
    };
    c.head("https://yandex.ru")
        .send()
        .map(|r| r.status().is_success() || r.status().is_redirection())
        .unwrap_or(false)
}
