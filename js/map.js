/* ============================================================
   map.js — Leaflet・ルーティング・スポット検索
   APIs: OSRM(ルーティング), Overpass(スポット), Nominatim(ジオコーディング)
============================================================ */

let map = null;
let registerMap = null;
let registerPin = null;
let minimaps = [];
let generatedRoutes = [];
let selectedRouteIndex = -1;

// ---- タイル設定 ----
// CartoDB Light: file://からでもRefererブロックなし、見やすい淡色テーマ
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_OPT = {
  attribution: '© OSM © CARTO',
  maxZoom: 19,
  subdomains: 'abcd',
  crossOrigin: true,
};

// ---- カスタムアイコン ----
function makeIcon(emoji, size = 28) {
  return L.divIcon({
    html: `<div style="font-size:${size}px;text-align:center;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">${emoji}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], className: '',
  });
}

// ================================================================
// 設定タブ: 地点登録マップ
// ================================================================
function initRegisterMap() {
  if (registerMap) return;
  const el = document.getElementById('register-map');
  if (!el) return;

  // 初期位置: 登録済みスポット1件目 or 大阪
  const spots = getSpots();
  const center = spots.length ? [spots[0].lat, spots[0].lng] : [34.6937, 135.5023];

  registerMap = L.map('register-map', { zoomControl: true }).setView(center, 15);
  L.tileLayer(TILE_URL, TILE_OPT).addTo(registerMap);

  // タップでピンを立てる
  registerMap.on('click', e => {
    if (registerPin) registerMap.removeLayer(registerPin);
    registerPin = L.marker(e.latlng, { icon: makeIcon('📍', 32), draggable: true }).addTo(registerMap);
    registerPin.bindPopup('ここをスタート地点に登録').openPopup();

    // 逆ジオコーディングで住所自動入力
    reverseGeocode(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => registerMap.invalidateSize(), 300);
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'ja' } }
    );
    const d = await r.json();
    const addr = document.getElementById('input-spot-address');
    if (addr && d.display_name) addr.value = d.display_name.split(',').slice(0,3).join(',');
  } catch(e) {}
}

// 地図ピンから登録
function addSpotFromMapPin() {
  if (!registerPin) { alert('地図をタップしてピンを立ててください'); return; }
  const ll   = registerPin.getLatLng();
  const name = (document.getElementById('input-spot-name')?.value || '').trim()
             || `地点 ${new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`;
  const addr = document.getElementById('input-spot-address')?.value || '';
  addSpot(ll.lat, ll.lng, name, addr);
  if (document.getElementById('input-spot-name')) document.getElementById('input-spot-name').value = '';
  if (document.getElementById('input-spot-address')) document.getElementById('input-spot-address').value = '';
  registerMap.removeLayer(registerPin);
  registerPin = null;
  showToast(`✅ "${name}" を登録しました!`);
}

// 現在地から登録
function registerCurrentAsSpot() {
  if (!navigator.geolocation) { alert('この端末ではGPSが使えません'); return; }
  const name = (document.getElementById('input-spot-name')?.value || '').trim();
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const n   = name || `現在地 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    addSpot(lat, lng, n, '');
    if (registerMap) {
      registerMap.setView([lat, lng], 16);
      if (registerPin) registerMap.removeLayer(registerPin);
      registerPin = L.marker([lat, lng], { icon: makeIcon('📍', 32) }).addTo(registerMap);
    }
    showToast(`✅ "${n}" を登録しました!`);
    if (document.getElementById('input-spot-name')) document.getElementById('input-spot-name').value = '';
  }, () => alert('位置情報の取得に失敗しました'), { enableHighAccuracy: true });
}

// 住所検索から登録
async function addSpotByAddress() {
  const name = (document.getElementById('input-spot-name')?.value || '').trim();
  const addr = (document.getElementById('input-spot-address')?.value || '').trim();
  if (!addr) { alert('住所を入力してください'); return; }
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1&countrycodes=jp`,
      { headers: { 'Accept-Language': 'ja' } }
    );
    const data = await r.json();
    if (!data.length) { alert('住所が見つかりませんでした'); return; }
    const lat  = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
    const n    = name || addr;
    addSpot(lat, lng, n, addr);
    if (registerMap) {
      registerMap.setView([lat, lng], 16);
      if (registerPin) registerMap.removeLayer(registerPin);
      registerPin = L.marker([lat, lng], { icon: makeIcon('📍', 32) }).addTo(registerMap);
    }
    showToast(`✅ "${n}" を登録しました!`);
    if (document.getElementById('input-spot-name')) document.getElementById('input-spot-name').value = '';
    if (document.getElementById('input-spot-address')) document.getElementById('input-spot-address').value = '';
  } catch(e) { alert('住所検索に失敗しました'); }
}

// ================================================================
// ルート生成
// ================================================================

// 歩行速度: 犬連れ散歩の実速度 (m/分)
// クン活・排泄・立ち止まりを考慮 → 約2.7km/h = 45m/分
const WALK_SPEED = 45;

// 道路係数: 実際の道路距離は直線距離の約1.2倍
// (1.40は縮小しすぎだったため1.20に修正)
const ROAD_FACTOR = 1.20;

function generateWaypoints(lat, lng, targetMinutes, idx, scaleFactor = 1.0, nearbyParks = []) {
  const settings   = getSettings();
  const targetDist = (targetMinutes * WALK_SPEED) / ROAD_FACTOR * scaleFactor;
  const half       = targetDist / 2;

  const angles = [0, (2 * Math.PI / 3), (4 * Math.PI / 3)];
  let   angle  = angles[idx] + (Math.random() - 0.5) * 0.6;

  // preferGreen: 近くに公園があればその方向へ角度をバイアス
  if (settings.preferGreen && nearbyParks.length) {
    const park    = nearbyParks[idx % nearbyParks.length];
    const cosLat_ = Math.cos(lat * Math.PI / 180);
    const dLng    = (park.lng - lng) * cosLat_;
    const dLat    = park.lat - lat;
    const parkAngle = Math.atan2(dLng, dLat);
    // 公園方向に30%バイアス
    angle = angle * 0.7 + parkAngle * 0.3;
  }

  // loop: 往路と復路で大きく角度を広げる(同じ道を通りにくくする)
  const spread = settings.loop ? 0.70 : 0.35;

  // avoidBusy: 中継点を手前寄りに置いて生活道路を通りやすくする
  const d1 = settings.avoidBusy ? half * 0.40 : half * 0.50;
  const d2 = settings.avoidBusy ? half * 0.75 : half * 0.90;
  const a1 = angle - spread;
  const a2 = angle + spread;

  const cosLat = Math.cos(lat * Math.PI / 180);
  return [
    { lat: lat + (d1 * Math.cos(a1)) / 111320, lng: lng + (d1 * Math.sin(a1)) / (111320 * cosLat) },
    { lat: lat + (d2 * Math.cos(a2)) / 111320, lng: lng + (d2 * Math.sin(a2)) / (111320 * cosLat) },
  ];
}

async function fetchOSRMRoute(startLat, startLng, wps) {
  const coords = [
    `${startLng},${startLat}`,
    ...wps.map(w => `${w.lng},${w.lat}`),
    `${startLng},${startLat}`,
  ].join(';');

  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`
    );
    const d = await r.json();
    if (d.code === 'Ok' && d.routes?.length) {
      const rt = d.routes[0];
      return {
        points:   rt.geometry.coordinates.map(c => [c[1], c[0]]),
        distance: rt.distance,
      };
    }
    return null;
  } catch(e) { return null; }
}

// 水飲み場を最寄り順に取得
async function fetchNearestWaterPoint(lat, lng, radiusM) {
  const q = `[out:json][timeout:8];
(
  node["amenity"="drinking_water"](around:${radiusM},${lat},${lng});
  node["amenity"="fountain"](around:${radiusM},${lat},${lng});
);
out body 5;`;
  try {
    const res  = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(q),
    });
    const data = await res.json();
    if (!data.elements?.length) return null;
    // 最寄り順でソート
    return data.elements
      .map(el => ({ lat: el.lat, lng: el.lon,
                    dist: calcDistance(lat, lng, el.lat, el.lon) }))
      .sort((a, b) => a.dist - b.dist)[0];
  } catch(e) { return null; }
}

// 距離が希望時間から外れすぎていたら補正スケールを返す
// targetMinutes の ±25% 以内に収まっていれば調整なし
function calcAdjustScale(actualDistance, targetMinutes) {
  const targetDist = targetMinutes * WALK_SPEED;
  const ratio      = actualDistance / targetDist;
  if (ratio > 1.25) return 1 / ratio;   // 長すぎ → 縮小
  if (ratio < 0.75) return 1 / ratio;   // 短すぎ → 拡大
  return null; // 調整不要
}

// ルート1本をフェッチ。距離が大きくズレたら1回だけスケール補正して再取得
async function fetchRouteWithAdjust(startLat, startLng, targetMinutes, idx, nearbyParks = [], waterPoint = null) {
  const wps1 = buildWaypoints(startLat, startLng, targetMinutes, idx, 1.0, nearbyParks, waterPoint);
  const result = await fetchOSRMRoute(startLat, startLng, wps1);
  if (!result) return null;

  const scale = calcAdjustScale(result.distance, targetMinutes);
  if (scale === null) return result;

  const wps2     = buildWaypoints(startLat, startLng, targetMinutes, idx, scale, nearbyParks, waterPoint);
  const adjusted = await fetchOSRMRoute(startLat, startLng, wps2);

  if (adjusted) {
    const targetDist = targetMinutes * WALK_SPEED;
    const diff1 = Math.abs(result.distance   - targetDist);
    const diff2 = Math.abs(adjusted.distance - targetDist);
    return diff2 < diff1 ? adjusted : result;
  }
  return result;
}

// 中継点を組み立てる(水飲み場がある場合は中継点に挿入)
function buildWaypoints(lat, lng, targetMinutes, idx, scaleFactor, nearbyParks, waterPoint) {
  const wps = generateWaypoints(lat, lng, targetMinutes, idx, scaleFactor, nearbyParks);
  // water設定オン かつ 水飲み場が目標距離の30〜70%圏内にある場合、折り返し点として挿入
  if (waterPoint && getSettings().water) {
    const targetDist = (targetMinutes * WALK_SPEED);
    const distToWater = calcDistance(lat, lng, waterPoint.lat, waterPoint.lng);
    if (distToWater < targetDist * 0.6 && distToWater > targetDist * 0.1) {
      // wps[1](折り返し点)を水飲み場付近に差し替え
      wps[1] = { lat: waterPoint.lat, lng: waterPoint.lng };
    }
  }
  return wps;
}

// Overpass: スポット検索(暑さ対応版)
// heatMode=true のとき 水飲み場・公園・日陰系スポットを優先取得
async function fetchSpots(lat, lng, radiusM, heatMode = false) {
  const r = Math.min(radiusM, 3000);

  // 暑い日は水飲み場・公園・ドッグランを最優先、取得件数を増やす
  const limit = heatMode ? 30 : 20;
  const q = `[out:json][timeout:12];
(
  node["amenity"="drinking_water"](around:${r},${lat},${lng});
  node["amenity"="toilets"](around:${r},${lat},${lng});
  node["leisure"~"dog_park|park|garden|playground"](around:${r},${lat},${lng});
  node["natural"~"wood|tree_row"](around:${r},${lat},${lng});
  node["amenity"~"fountain"](around:${r},${lat},${lng});
  node["tourism"~"attraction|viewpoint|artwork|museum|gallery"](around:${r},${lat},${lng});
  node["historic"~"monument|memorial|castle|ruins|wayside_shrine|building"](around:${r},${lat},${lng});
  node["amenity"~"place_of_worship"](around:${r},${lat},${lng});
  node["amenity"~"cafe|restaurant|ice_cream"](around:${r},${lat},${lng});
  node["dog"~"yes|leashed"](around:${r},${lat},${lng});
  node["shop"~"bakery|convenience"](around:${r},${lat},${lng});
);
out center body ${limit};`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(q),
    });
    const data = await res.json();
    return data.elements.map(el => ({
      name:  (el.tags?.name) || (el.tags?.['name:ja']) || getSpotTypeName(el.tags),
      lat:   el.lat ?? el.center?.lat,
      lng:   el.lon ?? el.center?.lon,
      icon:  getSpotIcon(el.tags),
      type:  getSpotTypeName(el.tags),
      dog:   el.tags?.dog === 'yes' || el.tags?.dog === 'leashed',
      hours: el.tags?.opening_hours || null,
    })).filter(s => s.lat && s.lng);
  } catch(e) { return []; }
}

function getSpotIcon(t) {
  if (!t) return '📍';
  if (t.historic)                       return '🏛️';
  if (t.tourism === 'museum')           return '🏛️';
  if (t.tourism === 'viewpoint')        return '👁️';
  if (t.tourism === 'artwork')          return '🎨';
  if (t.amenity === 'place_of_worship') return '⛩️';
  if (t.amenity === 'drinking_water')   return '🚰';
  if (t.amenity === 'toilets')          return '🚻';
  if (t.amenity === 'fountain')         return '⛲';
  if (t.amenity === 'cafe')             return '☕';
  if (t.amenity === 'restaurant')       return '🍽️';
  if (t.amenity === 'ice_cream')        return '🍦';
  if (t.leisure === 'dog_park')         return '🐕';
  if (t.leisure === 'park')             return '🌳';
  if (t.leisure === 'playground')       return '🛝';
  if (t.shop === 'bakery')              return '🥐';
  if (t.shop === 'convenience')         return '🏪';
  if (t.tourism === 'attraction')       return '⭐';
  return '📍';
}
function getSpotTypeName(t) {
  if (!t) return 'スポット';
  if (t.historic)                       return '史跡・記念碑';
  if (t.tourism === 'museum')           return '博物館・美術館';
  if (t.tourism === 'viewpoint')        return '展望スポット';
  if (t.tourism === 'artwork')          return 'アート';
  if (t.amenity === 'place_of_worship') return '神社・寺';
  if (t.amenity === 'drinking_water')   return '水飲み場';
  if (t.amenity === 'toilets')          return 'トイレ';
  if (t.amenity === 'fountain')         return '噴水';
  if (t.amenity === 'cafe')             return 'カフェ';
  if (t.amenity === 'restaurant')       return 'レストラン';
  if (t.amenity === 'ice_cream')        return 'アイスクリーム';
  if (t.leisure === 'dog_park')         return 'ドッグラン';
  if (t.leisure === 'park')             return '公園';
  if (t.leisure === 'playground')       return '遊び場';
  if (t.shop === 'bakery')              return 'パン屋';
  if (t.shop === 'convenience')         return 'コンビニ';
  return 'スポット';
}

// ================================================================
// 暑さ警告バナー生成
// ================================================================
function buildHeatWarningBanner(type, wdata) {
  if (!wdata || type === 'normal') return '';

  const cool  = wdata.coolInfo;
  const s28   = cool?.safePm28;
  const s25   = cool?.safePm25;
  const sun   = wdata.sunset ? parseSunset(wdata.sunset) : null;

  let icon, color, border, title, lines = [];

  if (type === 'extreme_shaded') {
    icon   = '🚫';
    color  = 'rgba(155,89,182,0.18)';
    border = 'rgba(155,89,182,0.5)';
    title  = `危険な暑さ (WBGT ${wdata.wbgt}°) — 日陰ルートで短時間に`;
    lines.push('⚠️ アスファルトは気温+10°C以上。肉球やけどに注意してください');
    if (s28) lines.push(`🌡️ ${formatTime(s28.time)}頃 (${s28.temp}°C) になると少し楽になります`);
    if (s25) lines.push(`✅ ${formatTime(s25.time)}頃 (${s25.temp}°C) まで待つとさらに安全です`);
    if (sun) lines.push(`🌇 日没 (${sun}) 以降の散歩が最もおすすめです`);

  } else if (type === 'shaded_short') {
    icon   = '⚠️';
    color  = 'rgba(231,76,60,0.15)';
    border = 'rgba(231,76,60,0.45)';
    title  = `厳重警戒 (WBGT ${wdata.wbgt}°) — 日陰ルートで短めに`;
    lines.push('💧 こまめな水分補給を忘れずに');
    if (s25) lines.push(`🌡️ ${formatTime(s25.time)}頃 (${s25.temp}°C) まで待つとさらに安心です`);
    if (sun) lines.push(`🌇 日没 (${sun}) 以降が理想的です`);

  } else if (type === 'shaded') {
    icon   = '⚡';
    color  = 'rgba(230,126,34,0.15)';
    border = 'rgba(230,126,34,0.45)';
    title  = `警戒 (WBGT ${wdata.wbgt}°) — 日陰・公園ルートを優先`;
    lines.push('💧 水分補給をこまめに行いましょう');
    if (s25) lines.push(`🕐 ${formatTime(s25.time)}頃 (${s25.temp}°C) になると快適になります`);
  }

  if (!title) return '';

  const lineHtml = lines.map(l =>
    `<div style="font-size:12px;color:rgba(232,234,240,0.75);margin-top:5px;line-height:1.5;">${l}</div>`
  ).join('');

  return `
    <div style="
      background:${color};
      border:1px solid ${border};
      border-radius:12px;
      padding:14px 16px;
      margin-bottom:14px;
    ">
      <div style="font-size:14px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;">
        <span>${icon}</span><span>${title}</span>
      </div>
      ${lineHtml}
    </div>`;
}

// ================================================================
// ルート提案メイン
// ================================================================
async function suggestRoutes() {
  const startLoc = getSelectedSpot();
  if (!startLoc) { alert('スタート地点を選んでください'); return; }

  document.getElementById('route-cards').innerHTML = `
    <div class="route-loading">
      <div class="spinner"></div>
      <p style="font-size:14px;color:var(--text-muted);">実際の道からルートを探しています...</p>
    </div>`;
  showScreen('route');

  const type  = getRouteRecommendationType();
  const wdata = currentWeatherData;

  // 暑さに応じて距離を調整(極端な暑さでも必ずルートを提案)
  let mins = selectedMinutes;
  if (type === 'extreme_shaded') mins = Math.min(selectedMinutes, 15);
  else if (type === 'shaded_short') mins = Math.min(selectedMinutes, 20);

  // ルート名・バッジ: 暑さレベルで日陰系に変更
  let names, badges, colors;
  const heatLevel = getHeatLevel();

  if (heatLevel >= 3) {
    // 危険〜厳重警戒: 全ルート日陰・公園優先
    names  = ['🌳 日陰ルートA', '🌿 日陰ルートB', '🏞️ 公園ルートC'];
    badges = ['badge-green', 'badge-green', 'badge-blue'];
    colors = ['#27AE60', '#2ECC71', '#3498DB'];
  } else if (heatLevel >= 2) {
    // 警戒: 日陰優先
    names  = ['🌿 日陰ルートA', '🌳 緑道ルートB', '✨ ルートC'];
    badges = ['badge-green', 'badge-blue', 'badge-purple'];
    colors = ['#27AE60', '#3498DB', '#9B59B6'];
  } else {
    names  = ['🌳 ルートA', '🧭 ルートB', '✨ ルートC'];
    badges = ['badge-green', 'badge-blue', 'badge-purple'];
    colors = ['#2ECC71', '#3498DB', '#9B59B6'];
  }

  generatedRoutes = [];

  const settings = getSettings();
  const targetDistM = mins * WALK_SPEED;

  // preferGreen: 近くの公園・緑道・川沿いエリアを取得してルート方向バイアスに使う
  let nearbyParks = [];
  if (settings.preferGreen) {
    try {
      const parkQ = `[out:json][timeout:10];
(
  node["leisure"~"park|garden|dog_park"](around:${targetDistM},${startLoc.lat},${startLoc.lng});
  node["natural"~"wood"](around:${targetDistM},${startLoc.lat},${startLoc.lng});
  node["waterway"~"river|stream|canal"](around:${targetDistM},${startLoc.lat},${startLoc.lng});
  node["natural"="water"](around:${targetDistM},${startLoc.lat},${startLoc.lng});
  way["waterway"~"river|stream|canal"](around:${targetDistM},${startLoc.lat},${startLoc.lng});
);
out center body 15;`;
      const parkRes  = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: 'data=' + encodeURIComponent(parkQ),
      });
      const parkData = await parkRes.json();
      nearbyParks = (parkData.elements || [])
        .map(el => ({
          lat: el.lat ?? el.center?.lat,
          lng: el.lon ?? el.center?.lon,
        }))
        .filter(p => p.lat != null && p.lng != null);
    } catch(e) { nearbyParks = []; }
  }

  // water: 近くの水飲み場を取得
  let waterPoint = null;
  if (settings.water) {
    waterPoint = await fetchNearestWaterPoint(startLoc.lat, startLoc.lng, targetDistM * 0.7);
  }

  // 補正付きルート取得(設定を反映)
  const results = await Promise.all([0,1,2].map(i =>
    fetchRouteWithAdjust(startLoc.lat, startLoc.lng, mins, i, nearbyParks, waterPoint)
  ));

  results.forEach((r, i) => {
    if (r) {
      const distKm = (r.distance / 1000).toFixed(1);
      const durMin = Math.round(r.distance / WALK_SPEED); // WALK_SPEED で統一
      generatedRoutes.push({
        name: names[i], badge: badges[i], color: colors[i],
        points: r.points, dist: distKm, duration: durMin,
        spots: [], heatLevel,
      });
    }
  });

  if (!generatedRoutes.length) {
    document.getElementById('route-cards').innerHTML =
      `<div class="empty-state"><p>ルートを取得できませんでした</p></div>`;
    return;
  }

  // スポット取得: 暑い時は水飲み場・日陰スポットを優先
  const radius = Math.min(mins * 45, 2800);
  const spots  = await fetchSpots(startLoc.lat, startLoc.lng, radius, heatLevel >= 2);

  generatedRoutes.forEach(route => {
    route.spots = spots.filter(s =>
      route.points.some(p => calcDistance(p[0], p[1], s.lat, s.lng) < 350)
    ).slice(0, 5);
  });

  renderRouteCards(startLoc, type, wdata);
}

function renderRouteCards(startLoc, type, wdata) {
  minimaps.forEach(m => m?.remove());
  minimaps = [];
  selectedRouteIndex = -1;
  document.getElementById('btn-go').disabled = true;

  // 警告バナー
  const warningHtml = buildHeatWarningBanner(type || getRouteRecommendationType(), wdata || currentWeatherData);

  let html = warningHtml;
  const heatLevel = getHeatLevel();

  generatedRoutes.forEach((route, i) => {
    const spotText = route.spots.length
      ? route.spots.map(s => `${s.icon}${s.name}`).join(' · ')
      : '';

    // 暑さレベルに応じたタグ
    let heatTag = '';
    if (heatLevel >= 3) {
      heatTag = '<span style="font-size:11px;background:rgba(46,204,113,0.2);color:#2ECC71;border:1px solid rgba(46,204,113,0.35);border-radius:10px;padding:2px 8px;">🌿 日陰優先</span>';
    } else if (heatLevel >= 2) {
      heatTag = '<span style="font-size:11px;background:rgba(230,126,34,0.2);color:#E67E22;border:1px solid rgba(230,126,34,0.35);border-radius:10px;padding:2px 8px;">☁️ 日陰推奨</span>';
    }

    html += `
      <div class="card route-card" id="route-card-${i}" onclick="selectRoute(${i})">
        <div class="card-glow"></div>
        <div class="route-card-inner">
          <div class="route-card-head">
            <span class="route-card-name">${route.name}</span>
            <span class="route-badge ${route.badge}">${route.dist}km</span>
          </div>
          <div class="route-card-meta" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <span>🚶 約${route.duration}分</span>
            ${heatTag}
          </div>
          ${spotText ? `<div class="route-card-spots">📍 ${spotText}</div>` : ''}
          <div class="route-minimap" id="minimap-${i}"></div>
        </div>
      </div>`;
  });

  document.getElementById('route-cards').innerHTML = html;

  // ミニマップ生成: DOMが確定してからサイズを正しく認識させるため
  // 各ミニマップを順番に生成(同時生成するとサイズ計算が競合する)
  function buildMinimap(i) {
    const container = document.getElementById(`minimap-${i}`);
    if (!container) return;

    // コンテナを block 表示に明示
    container.style.display = 'block';
    container.style.width   = '100%';
    container.style.height  = '140px';

    const route = generatedRoutes[i];
    const mm = L.map(container, {
      zoomControl:       false,
      attributionControl:false,
      dragging:          false,
      scrollWheelZoom:   false,
      doubleClickZoom:   false,
      touchZoom:         false,
      boxZoom:           false,
      keyboard:          false,
      tap:               false,
    });

    L.tileLayer(TILE_URL, TILE_OPT).addTo(mm);

    const poly = L.polyline(route.points, {
      color: route.color, weight: 5, opacity: 0.9,
    }).addTo(mm);

    L.marker([startLoc.lat, startLoc.lng], { icon: makeIcon('🏠', 20) }).addTo(mm);

    route.spots.forEach(s => {
      L.marker([s.lat, s.lng], { icon: makeIcon(s.icon, 14) }).addTo(mm)
        .bindPopup(`<b>${s.name}</b><br><small>${s.type}</small>`);
    });

    const bounds = poly.getBounds();

    // invalidateSize → fitBounds を確実に順序通りに実行
    mm.invalidateSize();
    mm.fitBounds(bounds, { padding: [16, 16] });

    // タイル読み込み後に再フィット(念のため)
    mm.once('load', () => {
      mm.invalidateSize();
      mm.fitBounds(bounds, { padding: [16, 16] });
    });

    minimaps.push(mm);
  }

  // 少し遅延させてDOMを安定させてから順番に生成
  setTimeout(() => {
    generatedRoutes.forEach((_, i) => buildMinimap(i));
    // 全生成後にもう一度サイズを確認
    setTimeout(() => {
      minimaps.forEach(m => {
        if (m) {
          m.invalidateSize();
        }
      });
    }, 500);
  }, 400);
}

function selectRoute(idx) {
  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`route-card-${idx}`).classList.add('selected');
  selectedRouteIndex = idx;
  document.getElementById('btn-go').disabled = false;
}

// ================================================================
// 散歩中マップ初期化
// ================================================================
function initWalkMap(lat, lng) {
  if (map) { map.remove(); map = null; }
  map = L.map('map').setView([lat, lng], 16);
  L.tileLayer(TILE_URL, TILE_OPT).addTo(map);
  L.marker([lat, lng], { icon: makeIcon('🏠', 30) }).addTo(map).bindPopup('スタート地点');
  setTimeout(() => map.invalidateSize(), 200);
}

// ルート + スポットをマップに描画
function drawRouteOnMap(route) {
  const poly = L.polyline(route.points, {
    color: route.color, weight: 5, opacity: 0.75, dashArray: '10,6',
  }).addTo(map);
  map.fitBounds(poly.getBounds(), { padding: [30, 30] });

  route.spots.forEach(s => {
    L.marker([s.lat, s.lng], { icon: makeIcon(s.icon, 24) }).addTo(map)
      .bindPopup(`<b>${s.name}</b><br><small>${s.type}${s.dog ? ' 🐕ペット可' : ''}</small>${s.hours ? `<br><small>⏰ ${s.hours}</small>` : ''}`);
  });
  return poly;
}

// スポットリスト描画(散歩中)
function renderSpotsListWalk(spots) {
  const div = document.getElementById('spots-list-walk');
  if (!spots.length) {
    div.innerHTML = '<div class="empty-state"><p>周辺にスポットが見つかりませんでした</p></div>';
    return;
  }
  div.innerHTML = spots.map(s => `
    <div class="spot-item">
      <div class="spot-icon">${s.icon}</div>
      <div class="spot-info">
        <div class="spot-name">${s.name}${s.dog ? ' <span style="font-size:10px;color:var(--secondary);">🐕OK</span>' : ''}</div>
        <div class="spot-type">${s.type}${s.hours ? ' · ' + s.hours : ''}</div>
      </div>
    </div>`).join('');
}

// 距離計算(ハバーサイン)
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
