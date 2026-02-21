<div align="center">

![YaPanoRipper](logo.png)

**Скачивай панорамы Яндекс.Карт в максимальном качестве**

[![Python](https://img.shields.io/badge/Python-3.9+-0c1422?style=flat-square&logo=python&logoColor=00b4ff)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.x-0c1422?style=flat-square&logo=flask&logoColor=00b4ff)](https://flask.palletsprojects.com)
[![License](https://img.shields.io/badge/License-MIT-0c1422?style=flat-square&logoColor=00b4ff)](LICENSE)
[![Built with Claude](https://img.shields.io/badge/Built_with-Claude_AI-0c1422?style=flat-square&logo=anthropic&logoColor=00b4ff)](https://claude.ai)

**Русский | [English](README_EN.md)**

</div>

---

## ⬡ Что это

**YaPanoRipper** — веб-приложение для скачивания панорам Яндекс.Карт в оригинальном разрешении. Поддерживает уличные панорамы и аэрофотосъёмку. Собирает изображение из тайлов и отдаёт единый JPEG файл.

```
19712 × 9856 px  ·  HI-RES
```

---

## ✦ Возможности

| | |
|---|---|
| 🛰 **Аэропанорамы** | По OID или прямой ссылке |
| 🚗 **Уличные панорамы** | По координатам или ссылке |
| 🗺 **Интерактивная карта** | Яндекс гибрид со слоем покрытия панорам |
| 📐 **Выбор качества** | HI-RES / HIGH / MEDIUM / LOW |
| 🖼 **Превью** | Полная панорама перед скачиванием |
| 🔄 **Ротация UA** | Пул из тысяч User-Agent строк |
| ⚡ **Async загрузка** | Параллельное скачивание тайлов |

---

## ⚙ Установка

```bash
git clone https://github.com/SkyNeko1/YaPanoRipper
cd YaPanoRipper
pip install -r requirements.txt
python app.py
```

Открыть в браузере: **http://localhost:5000**

---

## ◈ Использование

**По координатам** — кликни на карту или введи широту/долготу вручную.

**По OID аэропанорамы** — вставь OID из URL Яндекс.Карт. Это 4 числа через `_` в параметре `panorama[id]=`.

**По ссылке** — вставь любую ссылку Яндекс.Карт с открытой панорамой. Тип и параметры определятся автоматически.

---

## ◈ Качество

| Качество | Пример разрешения |
|----------|------------------|
| HI-RES   | 19712 × 9856 px  |
| HIGH     | 7168 × 3584 px   |
| MEDIUM   | 3584 × 1792 px   |
| LOW      | 1792 × 896 px    |

*Реальные размеры зависят от конкретной панорамы*

---

## ◈ Создано с помощью

Проект разработан в связке с **[Claude](https://claude.ai)** — AI ассистентом от [Anthropic](https://anthropic.com).

---

## ⚠ Дисклеймер

Проект создан в образовательных целях. Используй в соответствии с [условиями Яндекс.Карт](https://yandex.ru/legal/maps_termsofuse/).

---

<div align="center">

made with ♥ and [Claude](https://claude.ai)

</div>
