/* ============================================================
   walk.js — 散歩中のGPSトラッキング・マーカー・ログ保存
   モード: 'route'(提案ルート) / 'free'(フリー) / 'fav'(お気に入り)
============================================================ */

let walkStartTime    = null;
let walkTimerInterval= null;
let currentPosition  = null;
let watchId          = null;
let walkPath         = [];
let walkPolyline     = null;
let routePolyline    = null;
let toiletMarkers    = [];
let dogEncounters    = [];
let totalDistance    = 0;
let isWalking        = false;
let selectedMinutes  = 30;
let walkMode         = 'route'; // 'route' | 'free' | 'fav'
let currentFavRoute  = null;    // お気に入りモード時のルートデータ

// ================================================================
// 散歩開始 — 提案ルート
// ================================================================
function goWalk() {
  if (selectedRouteIndex < 0) return;
  const startLoc = getSelectedSpot();
  if (!startLoc) return;

  walkMode = 'route';
  currentFavRoute = null;
  _startWalkSession(startLoc.lat, startLoc.lng, generatedRoutes[selectedRouteIndex]);
}

// ================================================================
// 散歩開始 — フリー散歩
// ================================================================
function goFreeWalk() {
  const startLoc = getSelectedSpot();
  if (!startLoc) {
    showToast('⚠️ 設定タブでスタート地点を登録してください');
    return;
  }
  walkMode = 'free';
  currentFavRoute = null;
  _startWalkSession(startLoc.lat, startLoc.lng, null);
}

// ================================================================
// 散歩開始 — お気に入りルート
// ================================================================
function startFavRoute(id) {
  const fav = getFavRoutes().find(r => r.id === id);
  if (!fav) return;
  walkMode = 'fav';
  currentFavRoute = fav;
  _startWalkSession(fav.points[0][0], fav.points[0][1], fav);
}

// ================================================================
// 散歩セッション共通初期化
// ================================================================
function _startWalkSession(lat, lng, route) {
  isWalking      = true;
  walkStartTime  = Date.now();
  walkPath       = [];
  toiletMarkers  = [];
  dogEncounters  = [];
  totalDistance  = 0;
  currentPosition= null;

  showScreen('walk');
  initWalkMap(lat, lng);

  // モード表示バッジを更新
  const modeBadge = document.getElementById('walk-mode-badge');
  if (modeBadge) {
    if (walkMode === 'free') {
      modeBadge.textContent = '🐾 フリー散歩中';
      modeBadge.className = 'walk-mode-badge mode-free';
    } else if (walkMode === 'fav') {
      modeBadge.textContent = '⭐ ' + (route?.name || 'お気に入り');
      modeBadge.className = 'walk-mode-badge mode-fav';
    } else {
      modeBadge.textContent = '🗺️ ' + (route?.name || 'ルート散歩中');
      modeBadge.className = 'walk-mode-badge mode-route';
    }
  }

  // ルートがある場合は地図に描画
  if (route && route.points && route.points.length) {
    routePolyline = drawRouteOnMap(route);
    renderSpotsListWalk(route.spots || []);
  }

  startGPSTracking();
  walkTimerInterval = setInterval(updateWalkTimer, 1000);
}

// ================================================================
// GPS トラッキング
// ================================================================
function startGPSTracking() {
  if (!navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;

      if (currentPosition) {
        const d = calcDistance(currentPosition.lat, currentPosition.lng, lat, lng);
        if (d > 3 && d < 120) {
          totalDistance += d;
          walkPath.push([lat, lng]);
        }
      } else {
        walkPath.push([lat, lng]);
      }

      currentPosition = { lat, lng };

      if (map) {
        if (walkPolyline) map.removeLayer(walkPolyline);
        if (walkPath.length > 1) {
          walkPolyline = L.polyline(walkPath, {
            color: '#4ECDC4', weight: 5, opacity: 0.9,
          }).addTo(map);
        }
        map.panTo([lat, lng]);
      }

      document.getElementById('walk-distance').textContent = (totalDistance / 1000).toFixed(2);
    },
    err => console.warn('GPS:', err),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

function updateWalkTimer() {
  if (!walkStartTime) return;
  const e = Math.floor((Date.now() - walkStartTime) / 1000);
  document.getElementById('walk-timer').textContent =
    String(Math.floor(e/60)).padStart(2,'0') + ':' + String(e%60).padStart(2,'0');
}

// ================================================================
// トイレマーカー
// ================================================================
function markToilet(type) {
  if (currentPosition) {
    placeToiletMarker(type, currentPosition.lat, currentPosition.lng);
  } else {
    navigator.geolocation?.getCurrentPosition(
      pos => placeToiletMarker(type, pos.coords.latitude, pos.coords.longitude),
      ()  => placeToiletMarker(type, null, null),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
}

function placeToiletMarker(type, lat, lng) {
  const emoji = type === 'pee' ? '💧' : '💩';
  const label = type === 'pee' ? 'おしっこ' : 'うんち';
  const time  = new Date().toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });

  if (map && lat && lng) {
    L.marker([lat, lng], { icon: makeIcon(emoji, 24) }).addTo(map)
      .bindPopup(`${label} ${time}`).openPopup();
  }

  toiletMarkers.push({ type, lat, lng, time });
  if (navigator.vibrate) navigator.vibrate(60);
  showToast(`${emoji} ${label}を記録しました!`);
}

// ================================================================
// すれ違い犬
// ================================================================
function openDogModal() {
  document.getElementById('dog-modal').classList.add('show');
  setTimeout(() => document.getElementById('input-dog-breed-enc')?.focus(), 100);
}
function closeDogModal() {
  document.getElementById('dog-modal').classList.remove('show');
}
function addDogEncounter() {
  const breed = (document.getElementById('input-dog-breed-enc')?.value || '').trim() || '不明';
  dogEncounters.push({
    breed, time: new Date().toLocaleTimeString('ja-JP'),
    lat: currentPosition?.lat ?? null,
    lng: currentPosition?.lng ?? null,
  });
  if (map && currentPosition) {
    L.marker([currentPosition.lat, currentPosition.lng], { icon: makeIcon('🐶', 22) })
      .addTo(map).bindPopup(`すれ違い: ${breed}`);
  }
  closeDogModal();
  if (navigator.vibrate) navigator.vibrate([50,50,50]);
  showToast(`🐶 ${breed}とすれ違いを記録!`);
}

// ================================================================
// 散歩終了
// ================================================================
function // ================================================================
// 散歩終了ボタン — 長押し防止 (500ms)
// ================================================================
let _endHoldTimer   = null;
let _endHoldRaf     = null;
let _endHoldStart   = 0;
const END_HOLD_MS   = 500;

function startEndHold(e) {
  e.preventDefault();
  _endHoldStart = Date.now();
  const btn = document.getElementById('btn-end-walk');
  const bar = document.getElementById('btn-end-progress');
  if (btn) btn.classList.add('holding');

  // プログレスバーをアニメーション
  function tick() {
    const elapsed = Date.now() - _endHoldStart;
    const pct     = Math.min(elapsed / END_HOLD_MS * 100, 100);
    if (bar) bar.style.width = pct + '%';
    if (elapsed < END_HOLD_MS) {
      _endHoldRaf = requestAnimationFrame(tick);
    }
  }
  _endHoldRaf = requestAnimationFrame(tick);

  _endHoldTimer = setTimeout(() => {
    cancelEndHold();
    endWalk();
  }, END_HOLD_MS);
}

function cancelEndHold() {
  clearTimeout(_endHoldTimer);
  cancelAnimationFrame(_endHoldRaf);
  _endHoldTimer = null;
  _endHoldRaf   = null;
  const btn = document.getElementById('btn-end-walk');
  const bar = document.getElementById('btn-end-progress');
  if (btn) btn.classList.remove('holding');
  if (bar) bar.style.width = '0%';
}

endWalk() {

  isWalking = false;
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (walkTimerInterval) { clearInterval(walkTimerInterval); walkTimerInterval = null; }

  const elapsed = Math.floor((Date.now() - walkStartTime) / 1000);
  const peeCount = toiletMarkers.filter(t => t.type === 'pee').length;
  const pooCount = toiletMarkers.filter(t => t.type === 'poo').length;

  // 現在のルートデータ(お気に入り登録用に保持)
  const currentRoute = walkMode === 'route'
    ? generatedRoutes[selectedRouteIndex] || null
    : walkMode === 'fav' ? currentFavRoute : null;

  const entry = {
    date:      new Date().toISOString(),
    duration:  elapsed,
    distance:  totalDistance,
    toiletPee: peeCount,
    toiletPoo: pooCount,
    dogs:      dogEncounters.length,
    dogBreeds: dogEncounters.map(d => d.breed),
    path:      walkPath.slice(0, 200),
    wbgt:      currentWeatherData?.wbgt ?? null,
    weather:   currentWeatherData?.code ?? null,
    mode:      walkMode,
    favName:   walkMode === 'fav' ? (currentFavRoute?.name || null) : null,
  };
  addLog(entry);

  // 実績チェック
  const newBadges = checkNewAchievements(entry);

  // 完了モーダル表示
  showResultModal(elapsed, totalDistance, peeCount, pooCount, dogEncounters.length, newBadges, currentRoute);
}

function showResultModal(elapsed, dist, pee, poo, dogs, newBadges, routeData) {
  const grid = document.getElementById('result-grid');
  grid.innerHTML = [
    { val: `${Math.floor(elapsed/60)}分${elapsed%60 > 0 ? (elapsed%60)+'秒':''}`, label: '散歩時間' },
    { val: `${(dist/1000).toFixed(2)}km`, label: '歩いた距離' },
    { val: `💧${pee} / 💩${poo}`, label: 'トイレ' },
    { val: `🐶 ${dogs}匹`, label: 'すれ違い犬' },
  ].map(s => `
    <div class="card result-stat">
      <div class="card-glow"></div>
      <div class="result-stat-val">${s.val}</div>
      <div class="result-stat-label">${s.label}</div>
    </div>`).join('');

  const ach = document.getElementById('result-achievements');
  ach.innerHTML = newBadges.length
    ? `<div style="text-align:center;padding:10px 0;color:var(--accent);font-weight:700;font-size:14px;">🏅 新しい実績を解除!<br>${newBadges.map(b => b.icon + b.name).join(' ')}</div>`
    : '';

  // お気に入り登録ボタン: 提案ルートかお気に入りルートの場合のみ表示
  const favBtn = document.getElementById('btn-save-fav');
  if (favBtn) {
    if (routeData && routeData.points && walkMode !== 'free') {
      favBtn.style.display = 'block';
      favBtn.onclick = () => {
        const name = prompt('お気に入り名を入力してください', routeData.name || 'お気に入りルート');
        if (name !== null) {
          addFavRoute({ ...routeData, name: name.trim() || routeData.name });
          showToast('⭐ お気に入りに登録しました!');
          favBtn.style.display = 'none';
        }
      };
    } else {
      favBtn.style.display = 'none';
    }
  }

  document.getElementById('result-modal').classList.add('show');
}

function closeResultModal() {
  document.getElementById('result-modal').classList.remove('show');
  showScreen('home');
}
