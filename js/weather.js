/* ============================================================
   weather.js — 天気・WBGT・ルート推奨ロジック
   API: Open-Meteo (無料・キー不要)
============================================================ */

let currentWeatherData = null;

async function fetchWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast`
      + `?latitude=${lat}&longitude=${lng}`
      + `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,uv_index,visibility`
      + `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability`
      + `&daily=sunrise,sunset,uv_index_max,precipitation_sum`
      + `&timezone=Asia%2FTokyo`
      + `&forecast_days=2`;

    const r    = await fetch(url);
    const data = await r.json();
    const c    = data.current;

    const temp     = Math.round(c.temperature_2m);
    const humidity = c.relative_humidity_2m;
    const wind     = (c.wind_speed_10m / 3.6).toFixed(1);
    const code     = c.weather_code;
    const uv       = c.uv_index ?? '--';
    const vis      = c.visibility ? (c.visibility / 1000).toFixed(1) : '--';

    // WBGT 簡易計算 (Steadman式近似)
    const wbgt = calcWBGT(temp, humidity);

    // 時間予報から「涼しくなる時刻」を計算
    const coolInfo = calcCoolTime(data, wbgt);

    // 日没時刻
    const sunset = data.daily?.sunset?.[0] || null;

    currentWeatherData = { temp, humidity, wind, code, uv, vis, wbgt, coolInfo, sunset, hourly: data.hourly };

    // DOM更新
    document.getElementById('weather-temp').textContent     = `${temp}°C`;
    document.getElementById('weather-humidity').textContent = `${humidity}%`;
    document.getElementById('weather-wind').textContent     = `${wind}m/s`;
    document.getElementById('weather-uv').textContent       = uv;
    document.getElementById('weather-vis').textContent      = `${vis}km`;
    document.getElementById('weather-icon').textContent     = getWeatherEmoji(code);
    document.getElementById('weather-desc').textContent     = getWeatherText(code);

    updateWBGT(wbgt, coolInfo, sunset);
    return currentWeatherData;
  } catch(e) {
    document.getElementById('weather-desc').textContent = '天気を取得できませんでした';
    return null;
  }
}

// WBGT計算
function calcWBGT(temp, humidity) {
  return Math.round((0.735 * temp + 0.0066 * humidity * temp - 3.58) * 10) / 10;
}

// 時間予報から「何時に何度まで下がるか」「日没後いつ安全か」を計算
function calcCoolTime(data, currentWbgt) {
  if (!data.hourly) return null;

  const times  = data.hourly.time;
  const temps  = data.hourly.temperature_2m;
  const humids = data.hourly.relative_humidity_2m;
  const now    = new Date();

  // 今から24時間以内で WBGT < 28 になる最初の時刻を探す
  let safePm28 = null;  // WBGT28未満
  let safePm25 = null;  // WBGT25未満(警戒解除)

  for (let i = 0; i < times.length; i++) {
    const t   = new Date(times[i]);
    if (t <= now) continue;  // 過去はスキップ

    const w = calcWBGT(temps[i], humids[i]);
    if (!safePm28 && w < 28) safePm28 = { time: t, temp: Math.round(temps[i]), wbgt: w };
    if (!safePm25 && w < 25) safePm25 = { time: t, temp: Math.round(temps[i]), wbgt: w };
    if (safePm28 && safePm25) break;
  }

  return { safePm28, safePm25 };
}

// 時刻を「18:30」形式に
function formatTime(date) {
  if (!date) return null;
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

// 日没時刻を文字列に (ISO → HH:MM)
function parseSunset(sunsetStr) {
  if (!sunsetStr) return null;
  const d = new Date(sunsetStr);
  return isNaN(d) ? null : formatTime(d);
}

// ================================================================
// WBGT表示更新
// ================================================================
function updateWBGT(wbgt, coolInfo, sunset) {
  const bar = document.getElementById('wbgt-bar');
  const msg = document.getElementById('wbgt-msg');
  const sub = document.getElementById('wbgt-sub');
  const val = document.getElementById('wbgt-val');
  const ico = document.getElementById('wbgt-icon');

  val.textContent = `${wbgt}°`;
  bar.className   = 'wbgt-bar';

  const sunsetStr  = parseSunset(sunset);
  const safe28Time = coolInfo?.safePm28 ? formatTime(coolInfo.safePm28.time) : null;
  const safe25Time = coolInfo?.safePm25 ? formatTime(coolInfo.safePm25.time) : null;
  const safe28Temp = coolInfo?.safePm28?.temp;
  const safe25Temp = coolInfo?.safePm25?.temp;

  if (wbgt >= 31) {
    bar.classList.add('wbgt-extreme');
    ico.textContent = '🚫';
    msg.textContent = '危険な暑さ!日陰ルートで短めに';

    // サブメッセージ: 涼しくなる時刻を具体的に
    let advice = `WBGT ${wbgt}° / アスファルトは+10°C以上。肉球やけど注意`;
    if (safe28Time) {
      advice += ` / ${safe28Time}頃(${safe28Temp}°C)から少し楽になります`;
    }
    if (sunsetStr) {
      advice += ` / 日没(${sunsetStr})以降がおすすめ`;
    }
    sub.textContent = advice;

  } else if (wbgt >= 28) {
    bar.classList.add('wbgt-danger');
    ico.textContent = '⚠️';
    msg.textContent = '厳重警戒!日陰ルートで短時間に';

    let advice = `WBGT ${wbgt}° / こまめな水分補給を`;
    if (safe25Time) {
      advice += ` / ${safe25Time}頃(${safe25Temp}°C)まで待つとさらに安心`;
    }
    if (sunsetStr) {
      advice += ` / 日没(${sunsetStr})以降が理想的`;
    }
    sub.textContent = advice;

  } else if (wbgt >= 25) {
    bar.classList.add('wbgt-warning');
    ico.textContent = '⚡';
    msg.textContent = '警戒 — 日陰ルート優先で';

    let advice = `WBGT ${wbgt}° / 日陰・公園ルートがおすすめ`;
    if (safe25Time) {
      advice += ` / ${safe25Time}頃(${safe25Temp}°C)になると快適になります`;
    }
    sub.textContent = advice;

  } else if (wbgt >= 21) {
    bar.classList.add('wbgt-caution');
    ico.textContent = '☝️';
    msg.textContent = '注意 — 積極的に水分補給を';
    sub.textContent = `WBGT ${wbgt}° / まずまずのお散歩日和です`;

  } else {
    bar.classList.add('wbgt-safe');
    ico.textContent = '🐾';
    msg.textContent = '快適なお散歩日和です!';
    sub.textContent = `WBGT ${wbgt}° / のびのびお散歩できます`;
  }
}

// ================================================================
// ルートタイプ判定
// ================================================================
function getRouteRecommendationType() {
  if (!currentWeatherData) return 'normal';
  const w = currentWeatherData.wbgt;
  // extreme(31+) でも 'extreme' を返さず shaded_short にする
  // → 必ずルートを提案し、日陰優先・距離短縮で対応
  if (w >= 31) return 'extreme_shaded'; // 危険 → 日陰最優先・最短距離
  if (w >= 28) return 'shaded_short';   // 警戒 → 日陰優先・短め
  if (w >= 25) return 'shaded';         // 注意 → 日陰優先
  if (w >= 21) return 'normal';         // 通常
  return 'normal';
}

// 危険度レベル(0-4)
function getHeatLevel() {
  if (!currentWeatherData) return 0;
  const w = currentWeatherData.wbgt;
  if (w >= 31) return 4;
  if (w >= 28) return 3;
  if (w >= 25) return 2;
  if (w >= 21) return 1;
  return 0;
}

// 雨天フラグ
function isRainy() {
  if (!currentWeatherData) return false;
  return currentWeatherData.code >= 51;
}

// 天気コード → Emoji
function getWeatherEmoji(c) {
  if (c === 0)  return '☀️';
  if (c <= 3)   return '⛅';
  if (c <= 48)  return '☁️';
  if (c <= 67)  return '🌧️';
  if (c <= 77)  return '🌨️';
  if (c >= 95)  return '⛈️';
  return '🌤️';
}
function getWeatherText(c) {
  if (c === 0)  return '快晴';
  if (c <= 3)   return '晴れ時々くもり';
  if (c <= 48)  return 'くもり';
  if (c <= 57)  return '霧雨';
  if (c <= 67)  return '雨';
  if (c <= 77)  return '雪';
  if (c <= 82)  return '強い雨';
  if (c >= 95)  return '雷雨';
  return '晴れ';
}
