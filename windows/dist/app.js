const QUALITY = [
  { label:'HI-RES', desc:'Максимальное' },
  { label:'HIGH',   desc:'Высокое' },
  { label:'MEDIUM', desc:'Среднее' },
  { label:'LOW',    desc:'Быстрая загрузка' },
];

const BATCH = 12;
const MAX_TILE_ATTEMPTS = 3;
const HAS_OFFSCREEN = (typeof OffscreenCanvas !== 'undefined');
const EXPORT_FORMAT_STORAGE_KEY = 'yapanoripper.exportFormat';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tileUrl(id, zoom, x, y) {
  return `https://pano.maps.yandex.net/${id}/${zoom}.${x|0}.${y|0}`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile load failed'));
    img.src = url;
  });
}

async function loadTileRetry(url) {
  let lastErr = null;
  for (let a = 0; a < MAX_TILE_ATTEMPTS; a++) {
    try { return await loadImage(url); }
    catch(e) {
      lastErr = e;
      if (a < MAX_TILE_ATTEMPTS - 1)
        await sleep(250 * Math.pow(3, a) + Math.random()*200);
    }
  }
  throw lastErr;
}

async function runPool(items, initialLimit, worker, shouldStop) {
  let idx = 0, running = 0, doneCount = 0;
  let limit = Math.max(1, initialLimit);
  let recentFails = 0, recentOks = 0;
  const stopped = () => shouldStop && shouldStop();
  return new Promise((resolve) => {
    if (items.length === 0) return resolve({ cancelled: false });
    function finishIfDone() {
      if (doneCount === items.length || (stopped() && running === 0)) {
        resolve({ cancelled: !!stopped() });
        return true;
      }
      return false;
    }
    function pump() {
      if (finishIfDone()) return;
      while (running < limit && idx < items.length && !stopped()) {
        const i = idx++;
        running++;
        Promise.resolve(worker(items[i], i)).then(
          () => {
            running--; doneCount++;
            recentOks++;
            if (recentOks > 10 && limit < initialLimit) { limit++; recentOks = 0; }
            recentFails = Math.max(0, recentFails - 1);
            if (!finishIfDone()) pump();
          },
          () => {
            running--; doneCount++;
            recentFails++; recentOks = 0;
            if (recentFails >= 3 && limit > 2) { limit = Math.max(2, Math.floor(limit/2)); recentFails = 0; }
            if (!finishIfDone()) pump();
          }
        );
      }
      finishIfDone();
    }
    pump();
  });
}

function makeCanvas(w, h) {
  if (HAS_OFFSCREEN) { try { return new OffscreenCanvas(w, h); } catch(e) {} }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Браузер не смог сохранить изображение в выбранном формате.')), type, quality);
  });
}

function getSelectedFormat() {
  const el = document.getElementById('format-select');
  return el && el.value === 'png' ? 'png' : 'jpeg';
}

function loadSavedExportFormat() {
  try {
    return localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY) === 'png' ? 'png' : 'jpeg';
  } catch(e) {
    return 'jpeg';
  }
}

function saveExportFormat(format) {
  try {
    localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, format === 'png' ? 'png' : 'jpeg');
  } catch(e) {}
}

function formatExt(format) {
  return format === 'png' ? 'png' : 'jpg';
}

function formatMime(format) {
  return format === 'png' ? 'image/png' : 'image/jpeg';
}

function normalizeFilename(name, format) {
  const fallback = 'panorama';
  const clean = String(name || fallback)
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\.(jpe?g|png)$/i, '')
    .slice(0, 200) || fallback;
  return `${clean}.${formatExt(format)}`;
}

function onFormatChange() {
  const format = getSelectedFormat();
  saveExportFormat(format);
  const filename = document.getElementById('filename');
  if (filename) filename.value = normalizeFilename(filename.value, format);
}

function restoreExportFormat() {
  const format = document.getElementById('format-select');
  if (format) format.value = loadSavedExportFormat();
  onFormatChange();
}

function writeU16BE(bytes, offset, value) {
  bytes[offset] = (value >> 8) & 255;
  bytes[offset + 1] = value & 255;
}

function gpsDms(value) {
  const abs = Math.abs(Number(value));
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 1000000);
  return [[deg, 1], [min, 1], [sec, 1000000]];
}

function buildGpsExifSegment(lat, lon) {
  const ifd0Offset = 8;
  const ifd0Entries = 1;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const gpsOffset = ifd0Offset + ifd0Size;
  const gpsEntries = 5;
  const gpsSize = 2 + gpsEntries * 12 + 4;
  const latOffset = gpsOffset + gpsSize;
  const lonOffset = latOffset + 24;
  const tiffSize = lonOffset + 24;
  const payloadSize = 6 + tiffSize;
  const segment = new Uint8Array(4 + payloadSize);
  const view = new DataView(segment.buffer);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  writeU16BE(segment, 2, payloadSize + 2);
  segment.set([0x45,0x78,0x69,0x66,0,0], 4);

  const tiff = 10;
  segment[tiff] = 0x49;
  segment[tiff + 1] = 0x49;
  view.setUint16(tiff + 2, 42, true);
  view.setUint32(tiff + 4, ifd0Offset, true);

  function writeEntry(base, index, tag, type, count, value) {
    const pos = base + 2 + index * 12;
    view.setUint16(pos, tag, true);
    view.setUint16(pos + 2, type, true);
    view.setUint32(pos + 4, count, true);
    if (Array.isArray(value)) {
      segment.fill(0, pos + 8, pos + 12);
      segment.set(value.slice(0, 4), pos + 8);
    } else {
      view.setUint32(pos + 8, value, true);
    }
  }

  const ifd0 = tiff + ifd0Offset;
  view.setUint16(ifd0, ifd0Entries, true);
  writeEntry(ifd0, 0, 0x8825, 4, 1, gpsOffset);
  view.setUint32(ifd0 + 2 + ifd0Entries * 12, 0, true);

  const gps = tiff + gpsOffset;
  view.setUint16(gps, gpsEntries, true);
  writeEntry(gps, 0, 0x0000, 1, 4, [2, 3, 0, 0]);
  writeEntry(gps, 1, 0x0001, 2, 2, [lat >= 0 ? 78 : 83, 0, 0, 0]);
  writeEntry(gps, 2, 0x0002, 5, 3, latOffset);
  writeEntry(gps, 3, 0x0003, 2, 2, [lon >= 0 ? 69 : 87, 0, 0, 0]);
  writeEntry(gps, 4, 0x0004, 5, 3, lonOffset);
  view.setUint32(gps + 2 + gpsEntries * 12, 0, true);

  function writeRationals(offset, values) {
    values.forEach(([num, den], index) => {
      const pos = tiff + offset + index * 8;
      view.setUint32(pos, num, true);
      view.setUint32(pos + 4, den, true);
    });
  }
  writeRationals(latOffset, gpsDms(lat));
  writeRationals(lonOffset, gpsDms(lon));
  return segment;
}

async function addGpsExifToJpegBlob(blob, lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return blob;
  try {
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return blob;
    let insertAt = 2;
    while (insertAt + 4 < jpeg.length && jpeg[insertAt] === 0xff) {
      const marker = jpeg[insertAt + 1];
      if (marker < 0xe0 || marker > 0xef) break;
      const size = (jpeg[insertAt + 2] << 8) | jpeg[insertAt + 3];
      if (size < 2) break;
      insertAt += 2 + size;
    }
    const exif = buildGpsExifSegment(lat, lon);
    return new Blob([jpeg.slice(0, insertAt), exif, jpeg.slice(insertAt)], { type: 'image/jpeg' });
  } catch(e) {
    return blob;
  }
}

async function pasteFromClipboard() {
  hideErr('url');
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText)
      throw new Error('Clipboard API недоступен');
    const text = await navigator.clipboard.readText();
    const ta = document.getElementById('yandex-url');
    ta.value = (text || '').slice(0, 2000);
    ta.focus();
  } catch(e) {
    showErr('url', 'Не удалось вставить: ' + (e.message || e.name));
  }
}

let _currentObjectUrl = null;
function setCurrentObjectUrl(url) {
  if (_currentObjectUrl && _currentObjectUrl !== url) {
    try { URL.revokeObjectURL(_currentObjectUrl); } catch(e) {}
  }
  _currentObjectUrl = url;
}
window.addEventListener('beforeunload', () => {
  if (_currentObjectUrl) { try { URL.revokeObjectURL(_currentObjectUrl); } catch(e) {} }
});

let map, clickMarker;
let selectedZoom = null;
let foundData    = null;
let downloadCancelRequested = false;

function isDownloadCancelled() {
  return downloadCancelRequested;
}

function cancelDownload() {
  downloadCancelRequested = true;
  const btn = document.getElementById('btn-cancel-dl');
  if (btn) btn.disabled = true;
  const sub = document.getElementById('prog-sub');
  if (sub) sub.textContent = 'отмена...';
}

const OID_RE = /^\d{1,12}_\d{1,12}_\d{1,6}_\d{1,12}$/;

function yandexUrlCoords(lon, lat, provider) {
  return `https://api-maps.yandex.ru/services/panoramas/1.x/?l=stv&lang=ru_RU&ll=${lon},${lat}&origin=userAction&provider=${provider}`;
}
function yandexUrlOid(oid, provider) {
  return `https://api-maps.yandex.ru/services/panoramas/1.x/?l=stv&lang=ru_RU&oid=${oid}&origin=userAction&provider=${provider}`;
}

function parseApiResponse(data, provider) {
  try {
    const inner   = data.data.Data;
    const imgs    = inner.Images || inner.images || {};
    const zooms   = (imgs.Zooms || imgs.zooms || []).map(z => ({width:(typeof z.width==='number'&&isFinite(z.width))?z.width:0, height:(typeof z.height==='number'&&isFinite(z.height))?z.height:0}));
    if (!zooms.length) return null;
    const tiles   = imgs.Tiles || imgs.tiles || {};
    let imageId = imgs.imageId || imgs.image_id || inner.panoramaId || '';
    if(!/^[A-Za-z0-9_-]+$/.test(imageId)) return null;
    const coords  = (inner.Point || {}).coordinates || [null, null];
    const address = ((inner.Address || {}).formatted) || '';
    return { image_id: imageId, zooms,
             tile_width: tiles.width||512, tile_height: tiles.height||512,
             pano_lon: coords[0], pano_lat: coords[1], address };
  } catch(e) { return null; }
}

let _lastFindError = null;
async function yandexFind(params) {
  _lastFindError = null;
  const { oid, lat, lon } = params;
  const provider = params.provider || 'streetview';
  const providers = provider === 'unknown' ? ['air','streetview'] : [provider];
  for (const p of providers) {
    try {
      const url = oid ? yandexUrlOid(oid, p) : yandexUrlCoords(lon, lat, p);
      const r = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (!r.ok) { _lastFindError = yandexHttpError(r.status); continue; }
      const d = await r.json();
      if (d.status !== 'success') {
        // Yandex returns status='error' for points without panoramas.
        _lastFindError = 'Панорама в этой точке не найдена';
        continue;
      }
      const result = parseApiResponse(d, p);
      if (result) return result;
      _lastFindError = 'Панорама в этой точке не найдена';
    } catch(e) {
      _lastFindError = (e.name === 'TypeError')
        ? 'Не удалось получить данные от Яндекс.Карт. Проверь подключение к интернету.'
        : `Ошибка: ${e.message || e.name}`;
    }
  }
  return null;
}

function yandexHttpError(status) {
  if (status === 429) return 'Яндекс.Карты временно отказали в запросе (HTTP 429). Попробуй позже.';
  if (status >= 500) return `Ошибка API Яндекса (HTTP ${status}). Попробуй другую точку или повтори позже.`;
  return `Ошибка API Яндекса (HTTP ${status}). Попробуй другую точку или повтори позже.`;
}

const SHORT_URL_RE = /^https?:\/\/yandex\.[a-z]+\/maps\/-\/[A-Za-z0-9_-]+\/?(\?.*)?$/i;

function parseYandexUrl(url) {
  if (SHORT_URL_RE.test(url)) return { error: 'Короткие ссылки временно не поддерживаются' };
  try {
    const u  = new URL(url);
    const qs = new URLSearchParams(u.search);
    const isAir = url.includes('panorama[air]') || qs.get('panorama[air]') === 'true';
    const oid = qs.get('panorama[id]') || qs.get('panorama[oid]');
    if (oid && OID_RE.test(oid)) return { oid, provider: isAir ? 'air' : 'unknown' };
    let lat = null, lon = null;
    const pp = qs.get('panorama[point]');
    if (pp) { const p = pp.split(','); lon = parseFloat(p[0]); lat = parseFloat(p[1]); }
    if (!lat) { const ll = qs.get('ll'); if (ll) { const p = ll.split(','); lon = parseFloat(p[0]); lat = parseFloat(p[1]); } }
    if (!lat) { const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if (m) { lat = parseFloat(m[1]); lon = parseFloat(m[2]); } }
    if (!lat) return { error: 'Не найдены координаты в ссылке' };
    return { lat, lon, provider: 'streetview' };
  } catch(e) { return { error: e.message }; }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, p = Math.PI/180;
  const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p)*(1-Math.cos((lon2-lon1)*p))/2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

window.addEventListener('pageshow', () => {
  ['yandex-url', 'oid-input', 'lat', 'lon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
});

function initMap() {
  proj4.defs('EPSG:3395',
    '+proj=merc +a=6378137 +b=6356752.3142 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs');
  const yandexCRS = new L.Proj.CRS('EPSG:3395',
    '+proj=merc +a=6378137 +b=6356752.3142 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
    {
      resolutions: (function(){ var r=[]; for(var i=0;i<=20;i++) r.push(156543.03392800014/Math.pow(2,i)); return r; })(),
      origin: [-20037508.34, 20037508.34]
    });

  map = L.map('map', {
    crs: yandexCRS,
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
    fadeAnimation: true,
    zoomAnimation: true,
    markerZoomAnimation: true,
    inertia: true,
    inertiaDeceleration: 2200,
    inertiaMaxSpeed: 1500,
    easeLinearity: 0.1,
    zoomSnap: 0,
    zoomDelta: 0.5,
    wheelDebounceTime: 50,
    wheelPxPerZoomLevel: 180
  }).setView([55.7558, 37.6173], 13);

  L.tileLayer('https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', {
    maxZoom: 19, maxNativeZoom: 19, attribution: '', subdomains: '0123'
  }).addTo(map);
  L.tileLayer('https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', {
    maxZoom: 19, maxNativeZoom: 19, attribution: '', pane: 'overlayPane'
  }).addTo(map);
  map.on('mousemove', e => {
    document.getElementById('map-coords').textContent =
      `${e.latlng.lat.toFixed(6)},  ${e.latlng.lng.toFixed(6)}`;
  });
  map.on('click', e => {
    const { lat, lng } = e.latlng;
    document.getElementById('lat').value = lat.toFixed(7);
    document.getElementById('lon').value = lng.toFixed(7);
    document.getElementById('map-hint').style.display = 'none';
    placeMarker(lat, lng, false);
  });
}

function placeMarker(lat, lng, confirmed = false) {
  if (clickMarker) map.removeLayer(clickMarker);
  clickMarker = L.circleMarker([lat, lng], {
    radius: confirmed ? 9 : 7, color: '#ffffff', weight: 2,
    fillColor: confirmed ? '#00b4ff' : '#2a3a50',
    fillOpacity: confirmed ? 1 : 0.7,
    className: confirmed ? 'mx-marker' : 'mx-marker-soft'
  }).addTo(map);
}

function setBtn(id, loading) {
  const btn = document.getElementById('btn-' + id);
  const txt = document.getElementById('btn-' + id + '-txt');
  btn.disabled = loading;
  if(loading){const s=document.createElement('span');s.className='spin';txt.replaceChildren(s,document.createTextNode('ПОИСК...'));}else{const m={coords:'⟶ НАЙТИ ПАНОРАМУ',oid:'⟶ НАЙТИ ПО OID',url:'⟶ РАЗОБРАТЬ ССЫЛКУ'};txt.textContent=m[id]||'';}
}
function showErr(id, msg) {
  const el = document.getElementById(id + '-err');
  el.textContent = msg; el.style.display = 'block';
}
function hideErr(id) { document.getElementById(id + '-err').style.display = 'none'; }

async function onFindCoords() {
  hideErr('coords');
  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  if (isNaN(lat)||isNaN(lon)) { showErr('coords','Введи координаты'); return; }
  setBtn('coords', true);
  let result = null;
  for (const p of ['streetview','air']) {
    result = await yandexFind({lat, lon, provider: p});
    if (result) break;
  }
  setBtn('coords', false);
  if (!result) { showErr('coords', _lastFindError || 'Панорама не найдена'); return; }
  if (result.pano_lat && haversine(lat, lon, result.pano_lat, result.pano_lon) > 300) {
    showErr('coords','Ближайшая панорама далеко. Попробуй другую точку.'); return;
  }
  foundData = result;
  const pLat = result.pano_lat||lat, pLon = result.pano_lon||lon;
  placeMarker(pLat, pLon, true);
  map.setView([pLat, pLon], 15);
  openZoomModal(result);
}

async function onFindOid() {
  hideErr('oid');
  const oid = document.getElementById('oid-input').value.trim();
  if (!oid) { showErr('oid','Введи OID'); return; }
  if (!OID_RE.test(oid)) { showErr('oid','Неверный формат OID'); return; }
  setBtn('oid', true);
  const result = await yandexFind({oid, provider:'air'});
  setBtn('oid', false);
  if (!result) { showErr('oid', _lastFindError || 'Панорама не найдена'); return; }
  foundData = result;
  if (result.pano_lat&&result.pano_lon) { placeMarker(result.pano_lat,result.pano_lon,true); map.setView([result.pano_lat,result.pano_lon],15); }
  openZoomModal(result);
}

async function onParseUrl() {
  hideErr('url');
  const url = document.getElementById('yandex-url').value.trim();
  if (!url) { showErr('url','Вставь ссылку'); return; }
  setBtn('url', true);
  const parsed = parseYandexUrl(url);
  if (parsed.error) { showErr('url', parsed.error); setBtn('url',false); return; }
  const result = await yandexFind(parsed);
  setBtn('url', false);
  if (!result) { showErr('url', _lastFindError || 'Панорама не найдена'); return; }
  foundData = result;
  const lat = result.pano_lat||parsed.lat, lon = result.pano_lon||parsed.lon;
  if (lat&&lon) { placeMarker(lat,lon,true); map.setView([lat,lon],15); }
  openZoomModal(result);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function openZoomModal(data) {
  selectedZoom = null;
  restoreExportFormat();
  document.getElementById('btn-dl').disabled = true;
  document.getElementById('btn-dl-txt').textContent = '↓ ВЫБЕРИ КАЧЕСТВО';
  document.getElementById('m-zoom-err').style.display = 'none';
  document.getElementById('zoom-addr').textContent = data.address || data.image_id;

  const pidx = data.zooms.length - 1;
  const pz   = data.zooms[pidx];
  const wrap = document.getElementById('preview-wrap');
  wrap.innerHTML = '<div class="preview-skel"></div>';
  if (pz) buildClientPreview(data.image_id, pidx, data.tile_width||512, data.tile_height||512, pz.width, pz.height, wrap);

  const grid = document.getElementById('qgrid');
  grid.innerHTML = '';
  data.zooms.forEach((z, i) => {
    const q = QUALITY[i] || {label:`Z${i}`, desc:''};
    const c = document.createElement('div');
    c.className = 'qcard';
    c.appendChild(Object.assign(document.createElement("div"),{className:"qcard-lvl",textContent:q.label}));
    c.appendChild(Object.assign(document.createElement("div"),{className:"qcard-desc",textContent:q.desc}));
    c.appendChild(Object.assign(document.createElement("div"),{className:"qcard-px",textContent:z.width.toLocaleString()+"×"+z.height.toLocaleString()}));
    c.onclick = () => {
      document.querySelectorAll('.qcard').forEach(x=>x.classList.remove('sel'));
      c.classList.add('sel');
      selectedZoom = i;
      document.getElementById('btn-dl').disabled = false;
      document.getElementById('btn-dl-txt').textContent = `↓ ${q.label} · ${z.width.toLocaleString()}×${z.height.toLocaleString()}`;
    };
    grid.appendChild(c);
  });
  openModal('m-zoom');
}

async function buildClientPreview(id, zoom, tw, th, pw, ph, wrap) {
  const xr = Math.ceil(pw / tw);
  const yr = Math.ceil(ph / th);
  const canvas = document.createElement('canvas');
  canvas.width = pw; canvas.height = ph;
  canvas.style.cssText = 'width:100%;display:block';
  const ctx = canvas.getContext('2d');
  const coords = [];
  for (let x = 0; x < xr; x++) for (let y = 0; y < yr; y++) coords.push([x, y]);
  await runPool(coords, 6, async ([x, y]) => {
    try {
      const img = await loadTileRetry(tileUrl(id, zoom, x, y));
      ctx.drawImage(img, x*tw, y*th);
    } catch(e) {}
  });
  wrap.replaceChildren(canvas);
}

async function startDownload() {
  if (!foundData || selectedZoom === null) return;
  const zoom  = selectedZoom;
  const zInfo = foundData.zooms[zoom];
  const tw    = foundData.tile_width  || 512;
  const th    = foundData.tile_height || 512;
  const pw    = zInfo.width;
  const ph    = zInfo.height;
  const format = getSelectedFormat();
  const mime = formatMime(format);
  let fname = normalizeFilename(document.getElementById('filename').value || 'panorama', format);
  document.getElementById('filename').value = fname;
  const id    = foundData.image_id;
  downloadCancelRequested = false;

  closeModal('m-zoom');
  document.getElementById('prog-wrap').style.display = 'block';
  document.getElementById('done-wrap').style.display = 'none';
  const cancelBtn = document.getElementById('btn-cancel-dl');
  if (cancelBtn) cancelBtn.disabled = false;
  document.getElementById('plog').innerHTML = '';
  document.getElementById('track-fill').style.width = '0%';
  document.getElementById('prog-pct').textContent = '0%';
  plog(`${pw.toLocaleString()}×${ph.toLocaleString()}px · zoom ${zoom}`, 'inf');

  const xr = Math.ceil(pw / tw);
  const yr = Math.ceil(ph / th);
  const total = xr * yr;
  let done = 0;

  const canvas = makeCanvas(pw, ph);
  const ctx    = canvas.getContext('2d');

  let failed = 0;
  async function loadTile([x, y]) {
    if (downloadCancelRequested) return;
    try {
      const img = await loadTileRetry(tileUrl(id, zoom, x, y));
      if (downloadCancelRequested) return;
      ctx.drawImage(img, x*tw, y*th);
    } catch(e) { failed++; }
    finally {
      done++;
      if (!downloadCancelRequested) {
        const pct = Math.round(done/total*100);
        document.getElementById('track-fill').style.width = pct+'%';
        document.getElementById('prog-pct').textContent   = pct+'%';
        document.getElementById('prog-sub').textContent   =
          `${done} / ${total} тайлов` + (failed ? ` (✗${failed})` : '');
      }
    }
  }

  const coords = [];
  for (let x = 0; x < xr; x++) for (let y = 0; y < yr; y++) coords.push([x, y]);
  for (let i = coords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [coords[i], coords[j]] = [coords[j], coords[i]];
  }

  const poolResult = await runPool(coords, BATCH, loadTile, isDownloadCancelled);
  if (poolResult.cancelled) {
    document.getElementById('prog-sub').textContent = 'отменено';
    plog('✕ загрузка отменена', 'err');
    return;
  }

  if (failed > 0) {
    plog(`Не удалось скачать часть тайлов: ${failed} из ${total}. Итоговое изображение может быть с пропусками.`, 'err');
  }

  plog('✓ склейка...', 'inf');
  try {
    let blob = await canvasToBlob(canvas, mime, format === 'jpeg' ? 1.0 : undefined);
    if (format === 'jpeg') blob = await addGpsExifToJpegBlob(blob, foundData.pano_lat, foundData.pano_lon);
    const url  = URL.createObjectURL(blob);
    setCurrentObjectUrl(url);
    document.getElementById('prog-wrap').style.display = 'none';
    showDone(fname, zInfo, url, blob.size);
  } catch(e) {
    const msg = e.message || 'Не удалось собрать изображение. Возможно, не хватает памяти для такого качества.';
    plog('✗ ' + msg, 'err');
  }
}

function showDone(filename, zInfo, objectUrl, size) {
  document.getElementById('done-wrap').style.display = 'block';
  const mb = (size/1024/1024).toFixed(1);
  document.getElementById('done-meta').textContent =
    `${filename}  ·  ${zInfo.width.toLocaleString()}×${zInfo.height.toLocaleString()} px  ·  ${mb} MB`;
  const a = document.getElementById('btn-save');
  a.href = objectUrl; a.download = filename;
  a.onclick = () => {
    flashToast('Успешно сохранено в загрузки', filename, 'info', 4000);
    setTimeout(() => {
      try { URL.revokeObjectURL(objectUrl); } catch(e) {}
      if (_currentObjectUrl === objectUrl) _currentObjectUrl = null;
    }, 120000);
  };
}

function plog(msg, cls='') {
  const el = document.getElementById('plog');
  const d  = document.createElement('div');
  d.className = cls;
  d.textContent = `[${new Date().toLocaleTimeString('ru',{hour12:false})}] ${msg}`;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
}

// ── Desktop status / toast / UA pill ────────────────────────────────────────
const $ = (id) => document.getElementById(id);

let _toastLockUntil = 0;
function setToast(t) {
  // Backend polling must not stomp on a frontend flash toast.
  if (Date.now() < _toastLockUntil) return;
  const host = $('toastHost');
  if (!t) { host.classList.remove('show','info','warn','err'); return; }
  host.classList.remove('info','warn','err');
  host.classList.add(t.kind || 'info');
  $('toastTitle').textContent = t.title || '';
  $('toastDesc').textContent  = t.desc  || '';
  host.classList.add('show');
}
function flashToast(title, desc, kind, durationMs) {
  durationMs = durationMs || 4000;
  _toastLockUntil = Date.now() + durationMs;
  const host = $('toastHost');
  host.classList.remove('info','warn','err');
  host.classList.add(kind || 'info');
  $('toastTitle').textContent = title || '';
  $('toastDesc').textContent  = desc  || '';
  host.classList.add('show');
  setTimeout(() => {
    if (Date.now() >= _toastLockUntil) {
      host.classList.remove('show','info','warn','err');
    }
  }, durationMs + 30);
}
function setPill(state, txt) {
  const el = $('protPill');
  el.classList.remove('ok','warn','err');
  if (state) el.classList.add(state);
  $('protPillTxt').textContent = txt;
}

function tauriInvoke(command, args) {
  const inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv) return Promise.reject(new Error('Tauri backend unavailable'));
  return inv(command, args);
}

function openAbout() {
  const screen = $('about-screen');
  const video = $('about-video');
  if (!screen) return;
  screen.classList.add('open');
  screen.setAttribute('aria-hidden', 'false');
  if (video) video.play().catch(() => {});
}

function closeAbout() {
  const screen = $('about-screen');
  if (!screen) return;
  screen.classList.remove('open');
  screen.setAttribute('aria-hidden', 'true');
}

function updateModeText(mode) {
  return mode === 'portable' ? 'Portable' : 'Setup';
}

function resetUpdateButton() {
  const btn = $('about-update-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = 'Проверить обновления';
  btn.onclick = checkForAppUpdate;
}

async function checkForAppUpdate() {
  const status = $('about-status');
  const btn = $('about-update-btn');
  if (status) status.textContent = 'Проверяю обновления...';
  if (btn) btn.disabled = true;
  try {
    const info = await tauriInvoke('check_app_update');
    if (info.has_update) {
      if (status) status.textContent = `Доступна ${info.latest_version} · ${updateModeText(info.mode)}`;
      if (btn) {
        btn.textContent = 'Установить обновление';
        btn.onclick = installAppUpdate;
        btn.disabled = false;
      }
      flashToast('Обновление найдено', `${info.latest_version} · ${info.asset_name}`, 'info', 4200);
    } else {
      if (status) status.textContent = 'Установлена актуальная версия';
      resetUpdateButton();
      flashToast('Обновления', 'Установлена актуальная версия', 'info', 3200);
    }
  } catch(e) {
    if (status) status.textContent = 'Не удалось проверить обновления';
    resetUpdateButton();
    flashToast('Обновления', e.message || String(e), 'warn', 5200);
  }
}

async function installAppUpdate() {
  const status = $('about-status');
  const btn = $('about-update-btn');
  if (status) status.textContent = 'Скачиваю обновление...';
  if (btn) btn.disabled = true;
  try {
    const result = await tauriInvoke('install_app_update');
    if (status) {
      status.textContent = result.mode === 'portable'
        ? 'Заменяю portable и перезапускаю...'
        : 'Запускаю установщик...';
    }
    flashToast('Обновление', `${result.version} · ${result.asset_name}`, 'info', 5200);
  } catch(e) {
    if (status) status.textContent = 'Не удалось установить обновление';
    resetUpdateButton();
    flashToast('Обновление', e.message || String(e), 'err', 6500);
  }
}

function openGithubFromAbout() {
  tauriInvoke('open_github').catch(() => window.open('https://github.com/SkyNeko1/YaPanoRipper', '_blank'));
}

const aboutVideo = $('about-video');
const aboutFallback = $('about-fallback');
if (aboutVideo) {
  aboutVideo.addEventListener('canplay', () => aboutVideo.classList.add('ready'));
  aboutVideo.addEventListener('error', () => {
    aboutVideo.style.display = 'none';
    if (aboutFallback) aboutFallback.style.display = 'block';
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAbout();
});

async function pollStatus() {
  try {
    const s = await tauriInvoke('get_status');
    setToast(s.toast);
    if (s.toast && s.toast.kind === 'err')        setPill('err',  'Offline');
    else if (s.toast && s.toast.kind === 'warn')  setPill('warn', 'Whitelist');
    else if (s.toast && s.toast.kind === 'info')  setPill('warn', 'Updating');
    else if (s.ip && s.ua)                        setPill('ok',   'Protected');
    else                                          setPill('',     'Booting');
  } catch (e) {
    setPill('err', 'No backend');
  }
}
setInterval(pollStatus, 1000);
pollStatus();

// ── WebView2 quality-of-life ───────────────────────────────────────────────
// Suppress the native right-click context menu (Edge/WebView2 default).
window.addEventListener('contextmenu', e => e.preventDefault());

// Tauri WebView2 ignores target="_blank", so the GitHub button must be
// dispatched through a Rust command that hands the URL off to the OS.
function wireGithubLink() {
  const a = document.getElementById('ghLink');
  if (!a) return;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    tauriInvoke('open_github').catch(() => window.open(a.href, '_blank'));
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireGithubLink, { once: true });
} else {
  wireGithubLink();
}

function wireUiControls() {
  $('btn-about').addEventListener('click', openAbout);
  $('btn-coords').addEventListener('click', onFindCoords);
  $('btn-oid').addEventListener('click', onFindOid);
  $('btn-paste').addEventListener('click', pasteFromClipboard);
  $('btn-url').addEventListener('click', onParseUrl);
  $('btn-cancel-dl').addEventListener('click', cancelDownload);
  $('btn-about-close').addEventListener('click', closeAbout);
  $('btn-about-github').addEventListener('click', openGithubFromAbout);
  $('btn-zoom-close').addEventListener('click', () => closeModal('m-zoom'));
  $('format-select').addEventListener('change', onFormatChange);
  $('btn-zoom-cancel').addEventListener('click', () => closeModal('m-zoom'));
  $('btn-dl').addEventListener('click', startDownload);
  resetUpdateButton();
}

wireUiControls();

try {
  initMap();
} catch (error) {
  console.error('Map initialization failed', error);
  flashToast('Карта', 'Не удалось инициализировать карту', 'err', 6500);
}
