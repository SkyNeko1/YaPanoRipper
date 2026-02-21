<div align="center">

![YaPanoRipper](logo.png)

**Download Yandex Maps panoramas at full resolution**

[![Python](https://img.shields.io/badge/Python-3.9+-0c1422?style=flat-square&logo=python&logoColor=00b4ff)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.x-0c1422?style=flat-square&logo=flask&logoColor=00b4ff)](https://flask.palletsprojects.com)
[![License](https://img.shields.io/badge/License-MIT-0c1422?style=flat-square&logoColor=00b4ff)](LICENSE)
[![Built with Claude](https://img.shields.io/badge/Built_with-Claude_AI-0c1422?style=flat-square&logo=anthropic&logoColor=00b4ff)](https://claude.ai)

**[Русский](README.md) | [English](README_EN.md)**

</div>

---

## ⬡ What is this

**YaPanoRipper** is a web application for downloading Yandex Maps panoramas at their original resolution. Supports both street-level and aerial panoramas. Assembles the full image from tiles and exports a single high-resolution JPEG.

```
19712 × 9856 px  ·  HI-RES
```

---

## ✦ Features

| | |
|---|---|
| 🛰 **Aerial panoramas** | Via OID or direct Yandex Maps link |
| 🚗 **Street panoramas** | Via coordinates or link |
| 🗺 **Interactive map** | Yandex hybrid with panorama coverage layer |
| 📐 **Quality selector** | HI-RES / HIGH / MEDIUM / LOW |
| 🖼 **Full preview** | Entire panorama shown before download |
| 🔄 **UA rotation** | Pool of thousands of User-Agent strings |
| ⚡ **Async download** | Parallel tile fetching |

---

## ⚙ Installation

```bash
git clone https://github.com/yourusername/YaPanoRipper
cd YaPanoRipper
pip install -r requirements.txt
python app.py
```

Open in browser: **http://localhost:5000**

---

## ◈ Usage

**By coordinates** — click on the map or type latitude/longitude manually.

**By aerial OID** — paste the OID from a Yandex Maps URL. It's 4 numbers separated by `_` in the `panorama[id]=` parameter.

**By link** — paste any Yandex Maps URL with an open panorama. Type and parameters are detected automatically.

---

## ◈ Quality

| Quality | Example resolution |
|---------|-------------------|
| HI-RES  | 19712 × 9856 px   |
| HIGH    | 7168 × 3584 px    |
| MEDIUM  | 3584 × 1792 px    |
| LOW     | 1792 × 896 px     |

*Actual dimensions depend on the specific panorama*

---

## ◈ Built with

This project was built in collaboration with **[Claude](https://claude.ai)** — an AI assistant by [Anthropic](https://anthropic.com).

---

## ⚠ Disclaimer

For educational purposes only. Use in accordance with [Yandex Maps Terms of Use](https://yandex.ru/legal/maps_termsofuse/).

---

<div align="center">

made with `#00b4ff` and [Claude](https://claude.ai)

</div>
