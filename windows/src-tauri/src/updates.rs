use serde::Serialize;
use std::{
    fs,
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

const LATEST_RELEASE_PAGE: &str = "https://github.com/SkyNeko1/YaPanoRipper/releases/latest";
const RELEASE_DOWNLOAD_PREFIX: &str = "https://github.com/SkyNeko1/YaPanoRipper/releases/download/";
const SETUP_ASSET: &str = "YaPanoRipper-setup.exe";
const PORTABLE_ASSET: &str = "YaPanoRipper-portable.exe";

#[derive(Debug)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    has_update: bool,
    mode: String,
    asset_name: String,
    asset_size: Option<u64>,
    release_url: String,
    notes: Option<String>,
    published_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InstallUpdateResult {
    mode: String,
    version: String,
    asset_name: String,
}

#[tauri::command]
pub fn check_app_update() -> Result<UpdateInfo, String> {
    let release = fetch_latest_release()?;
    let mode = detect_install_mode();
    let asset = release_asset(&release, &mode)?;
    let asset_name = asset.name.clone();
    let asset_size = asset.size;
    let latest_version = release.tag_name.clone();
    Ok(UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        latest_version,
        has_update: version_is_newer(&release.tag_name, env!("CARGO_PKG_VERSION")),
        mode,
        asset_name,
        asset_size,
        release_url: release.html_url.clone(),
        notes: None,
        published_at: None,
    })
}

#[tauri::command]
pub fn install_app_update(app: tauri::AppHandle) -> Result<InstallUpdateResult, String> {
    let release = fetch_latest_release()?;
    if !version_is_newer(&release.tag_name, env!("CARGO_PKG_VERSION")) {
        return Err("No update available".into());
    }

    let mode = detect_install_mode();
    let asset = release_asset(&release, &mode)?;
    let asset_name = asset.name.clone();
    let update_path = download_asset(asset)?;

    if mode == "portable" {
        start_portable_replace(&update_path)?;
    } else {
        start_setup_installer(&update_path)?;
    }

    let result = InstallUpdateResult {
        mode,
        version: release.tag_name.clone(),
        asset_name,
    };

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        app.exit(0);
    });

    Ok(result)
}

fn fetch_latest_release() -> Result<GithubRelease, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("YaPanoRipper-Updater")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .head(LATEST_RELEASE_PAGE)
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub update check failed: HTTP {}",
            response.status()
        ));
    }

    let final_url = response.url().clone();
    let tag = final_url
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).last())
        .filter(|tag| is_safe_release_tag(*tag))
        .ok_or_else(|| "Could not detect latest release tag".to_string())?
        .to_string();

    Ok(GithubRelease {
        tag_name: tag.clone(),
        html_url: final_url.to_string(),
        assets: vec![
            GithubAsset {
                name: SETUP_ASSET.into(),
                browser_download_url: release_asset_url(&tag, SETUP_ASSET),
                size: None,
            },
            GithubAsset {
                name: PORTABLE_ASSET.into(),
                browser_download_url: release_asset_url(&tag, PORTABLE_ASSET),
                size: None,
            },
        ],
    })
}

fn release_asset<'a>(release: &'a GithubRelease, mode: &str) -> Result<&'a GithubAsset, String> {
    let expected = if mode == "portable" {
        PORTABLE_ASSET
    } else {
        SETUP_ASSET
    };

    release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case(expected))
        .ok_or_else(|| format!("Release asset not found: {expected}"))
}

fn detect_install_mode() -> String {
    let exe_name = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .unwrap_or_default()
        .to_ascii_lowercase();

    if exe_name.contains("portable") {
        "portable".into()
    } else {
        "setup".into()
    }
}

fn version_is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

fn parse_version(input: &str) -> Option<(u64, u64, u64)> {
    let clean = input
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .split(|c| c == '-' || c == '+')
        .next()?;
    let mut parts = clean.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn download_asset(asset: &GithubAsset) -> Result<PathBuf, String> {
    if !asset
        .browser_download_url
        .starts_with(RELEASE_DOWNLOAD_PREFIX)
    {
        return Err("Unexpected update asset host".into());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("YaPanoRipper-Updater")
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Update download failed: HTTP {}",
            response.status()
        ));
    }

    let dir = std::env::temp_dir().join("YaPanoRipper-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&asset.name);
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    std::io::copy(&mut response, &mut file).map_err(|e| e.to_string())?;
    Ok(path)
}

fn start_setup_installer(path: &Path) -> Result<(), String> {
    Command::new(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn start_portable_replace(update_path: &Path) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script_path = std::env::temp_dir()
        .join("YaPanoRipper-update")
        .join("replace-portable.ps1");
    let pid = std::process::id();
    let script = format!(
        "$ErrorActionPreference = 'Stop'\n\
         Wait-Process -Id {pid} -ErrorAction SilentlyContinue\n\
         Start-Sleep -Milliseconds 400\n\
         Copy-Item -LiteralPath {src} -Destination {dst} -Force\n\
         Start-Process -FilePath {dst}\n",
        src = ps_literal(update_path),
        dst = ps_literal(&current_exe),
    );

    if let Some(parent) = script_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = File::create(&script_path).map_err(|e| e.to_string())?;
    file.write_all(script.as_bytes())
        .map_err(|e| e.to_string())?;

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(&script_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn ps_literal(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "''"))
}

fn release_asset_url(tag: &str, asset: &str) -> String {
    format!("{RELEASE_DOWNLOAD_PREFIX}{tag}/{asset}")
}

fn is_safe_release_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 64
        && tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}
