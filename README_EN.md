<div align="center">

![YaPanoRipper](logo.png)

**Download Yandex Maps panoramas at full resolution**

[![Live Demo](https://img.shields.io/badge/Live_Demo-yap.skyne.ru-0c1422?style=flat-square&logo=googlechrome&logoColor=00b4ff)](https://yap.skyne.ru)
[![License](https://img.shields.io/badge/License-Elastic--2.0-0c1422?style=flat-square&logoColor=00b4ff)](LICENSE)
[![Built with Claude](https://img.shields.io/badge/Built_with-Claude_AI-0c1422?style=flat-square&logo=anthropic&logoColor=00b4ff)](https://claude.ai)

**[Русский](README.md) | English**

</div>

---

## ⬡ What is this

**YaPanoRipper** is a tool for downloading Yandex Maps panoramas at their original resolution. Supports both street-level and aerial panoramas. Assembles the full image from tiles and exports a single JPEG.

```
19712 × 9856 px  ·  HI-RES
```

---

## ⭐ Recommended — online

Just open it in your browser:

### → **[yap.skyne.ru](https://yap.skyne.ru)** ←

No installation. Everything works right in the tab.

---

## 🖥 Windows desktop version

Native Tauri (Rust) application with automatic User-Agent rotation to bypass anti-bot limits.

**Download v1.1:**

- 📦 **[YaPanoRipper-setup.exe](YaPanoRipper-setup.exe)** — installer (1.7 MB)
- 🚀 **[YaPanoRipper-portable.exe](YaPanoRipper-portable.exe)** — portable build (4.5 MB)

Or grab them from [Releases](https://github.com/SkyNeko1/YaPanoRipper/releases).

> ⚠️ **Auto-update is not implemented yet.** To get a newer version, download it again from Releases.

Desktop sources live in `windows/`.

---

## ✦ Features

- 🛰 **Aerial panoramas** — via OID or direct Yandex Maps link *(exclusive)*
- 🚗 **Street panoramas** — via coordinates or link
- 🗺 **Interactive map** — Yandex Maps
- 📐 **Quality selector** — HI-RES / HIGH / MEDIUM / LOW
- 🖼 **Full preview** — entire panorama shown before download
- 📋 **Paste from clipboard** — one-click paste for OID / URL

---

## ◈ Usage

**By coordinates** — click on the map or type latitude/longitude manually.

**By aerial OID** — paste the OID from a Yandex Maps URL.

**By link** — paste any Yandex Maps URL with an open panorama. Type and parameters are detected automatically.

---

## ◈ Quality

| Quality | Example resolution |
|---------|--------------------|
| HI-RES  | 19712 × 9856 px    |
| HIGH    | 7168 × 3584 px     |
| MEDIUM  | 3584 × 1792 px     |
| LOW     | 1792 × 896 px      |

*Actual dimensions depend on the specific panorama*

---

<details>
<summary><h2>🔽 If you need a local version</h2></summary>

For those who prefer to run everything locally.

### Installation

1. Download **[index.html](https://raw.githubusercontent.com/SkyNeko1/YaPanoRipper/main/index.html)** (right-click → "Save as…")
2. Open the saved file in your browser by double-clicking it

That's it. One file — one page.

</details>

---

## ◈ Built with

This project was built in collaboration with **[Claude](https://claude.ai)** — an AI assistant by [Anthropic](https://anthropic.com).

---

## ⚠ Disclaimer

This tool is created for **educational and research purposes**.

- All data (panoramas, imagery, geodata) belongs to **Yandex LLC** and is used in accordance with the [Yandex Maps Terms of Use](https://yandex.ru/legal/maps_termsofuse/)
- The user is solely responsible for complying with applicable laws and Yandex Maps terms when using this tool
- The author bears no responsibility for how third parties use this tool

---

## ✿ Acknowledgments

- **[zer0-dev/yandex-pano-downloader](https://github.com/zer0-dev/yandex-pano-downloader)** — for the original idea. The repository helped with the API.

---

## License

Distributed under the [Elastic License 2.0](LICENSE). Hosting as a managed service is prohibited without author's consent.

---

<div align="center">

made with ♥ and [Claude](https://claude.ai)

</div>

