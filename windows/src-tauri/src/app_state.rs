//! Shared app state — toast, ip, ua. Mirrors src/app.py::AppState.
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::network;
use crate::state::{self, PersistedState};
use crate::ua_pool;

#[derive(Serialize, Clone, Debug)]
pub struct Toast {
    pub title: String,
    pub desc: String,
    pub kind: String, // "info" | "warn" | "err"
}

pub struct Inner {
    pub data: PersistedState,
    pub ip: Option<String>,
    pub ua: Option<String>,
    pub ua_source: Option<String>,
    pub toast: Option<Toast>,
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<Inner>>,
}

impl AppState {
    pub fn new() -> Self {
        let data = state::load();
        Self {
            inner: Arc::new(Mutex::new(Inner {
                data,
                ip: None,
                ua: None,
                ua_source: None,
                toast: None,
            })),
        }
    }

    fn set_toast(&self, title: &str, desc: &str, kind: &str) {
        let mut i = self.inner.lock();
        i.toast = Some(Toast {
            title: title.into(),
            desc: desc.into(),
            kind: kind.into(),
        });
    }

    fn clear_toast(&self) {
        self.inner.lock().toast = None;
    }

    pub fn get_status(&self) -> serde_json::Value {
        let i = self.inner.lock();
        serde_json::json!({
            "ip": i.ip,
            "ua": i.ua,
            "ua_source": i.ua_source,
            "toast": i.toast,
        })
    }

    /// Boot sequence: wait for net -> public IP -> refresh pools -> assign UA.
    pub fn startup(&self) {
        // 1. Internet wait loop.
        loop {
            if network::is_internet_alive() {
                break;
            }
            self.set_toast("У вас нет интернета", "", "err");
            thread::sleep(Duration::from_secs(5));
        }
        self.clear_toast();

        // 2. Public IP.
        let ip = network::get_public_ip();
        {
            let mut i = self.inner.lock();
            i.ip = ip.clone();
        }

        // 3. UA pools refresh if stale.
        let stale = ua_pool::is_pool_stale(&self.inner.lock().data);
        if stale {
            self.set_toast("Обновляем защиту", "Загружаем актуальные UA-пулы…", "info");
            let pools = ua_pool::fetch_all_pools();
            if !pools.is_empty() {
                let mut i = self.inner.lock();
                i.data.ua_pools = pools;
                i.data.ua_pools_updated_at = Some(ua_pool::now_secs());
                let _ = state::save(&i.data);
                drop(i);
                self.clear_toast();
            } else {
                self.diagnose_failed_pool_fetch();
            }
        }

        // 4. Pick / reuse UA for this IP.
        let new_ua = {
            let mut i = self.inner.lock();
            ua_pool::get_or_assign_ua(&mut i.data, ip.clone())
        };
        {
            let mut i = self.inner.lock();
            let _ = state::save(&i.data);
            i.ua = Some(new_ua);
            i.ua_source = i.data.ua_source.clone();
        }
    }

    pub fn force_update_pools(&self) {
        let me = self.clone();
        thread::spawn(move || {
            me.set_toast("Обновляем защиту", "", "info");
            let pools = ua_pool::fetch_all_pools();
            if !pools.is_empty() {
                let mut i = me.inner.lock();
                i.data.ua_pools = pools;
                i.data.ua_pools_updated_at = Some(ua_pool::now_secs());
                let _ = state::save(&i.data);
                drop(i);
                me.clear_toast();
            } else {
                me.diagnose_failed_pool_fetch();
            }
        });
    }

    fn diagnose_failed_pool_fetch(&self) {
        if network::is_yandex_reachable() {
            self.set_toast(
                "Белые списки",
                "Похоже, на вашем интернете включены белые списки. Мы попробуем обновить защиту позже.",
                "warn",
            );
        } else {
            self.set_toast("У вас нет интернета", "", "err");
        }
    }

    pub fn reset(&self) {
        state::reset();
        {
            let mut i = self.inner.lock();
            i.data = PersistedState::default();
            i.ip = None;
            i.ua = None;
            i.ua_source = None;
            i.toast = None;
        }
        let me = self.clone();
        thread::spawn(move || me.startup());
    }
}
