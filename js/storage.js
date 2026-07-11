/* ============================================================
   storage.js — localStorage CRUD
   全データの読み書きをここで管理
============================================================ */

// ================================================================
// XSS対策: ユーザー入力をinnerHTMLに入れる前に必ずこれを通す
// ================================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DB = {
  SPOTS:   'wanpo_spots',
  LOGS:    'wanpo_logs',
  DOG:     'wanpo_dog',
  SETTINGS:'wanpo_settings',
  FAV_ROUTES: 'wanpo_fav_routes',
};

function getSpots()    { return JSON.parse(localStorage.getItem(DB.SPOTS)    || '[]'); }
function saveSpots(d)  { localStorage.setItem(DB.SPOTS, JSON.stringify(d)); }

function getLogs()     { return JSON.parse(localStorage.getItem(DB.LOGS)     || '[]'); }

function getDogProfile()    { return JSON.parse(localStorage.getItem(DB.DOG) || '{}'); }
function saveDogProfile_()  { /* alias for save below */ }

function getSettings() {
  return Object.assign({
    avoidBusy:   true,
    preferGreen: true,
    loop:        false,
    water:       true,
  }, JSON.parse(localStorage.getItem(DB.SETTINGS) || '{}'));
}
function saveSettings(d) { localStorage.setItem(DB.SETTINGS, JSON.stringify(d)); }

// ---- スポット操作 ----
function addSpot(lat, lng, name, address) {
  const spots = getSpots();
  spots.push({ id: Date.now(), lat, lng, name, address: address || '' });
  saveSpots(spots);
  updateSpotsUI();
}
function deleteSpot(id) {
  saveSpots(getSpots().filter(s => s.id !== id));
  updateSpotsUI();
}
function getSelectedSpot() {
  const sel = document.getElementById('spot-selector');
  if (!sel || !sel.value) return null;
  return getSpots().find(s => String(s.id) === sel.value) || null;
}

// ---- お気に入りルート操作 ----
function getFavRoutes()   { return JSON.parse(localStorage.getItem(DB.FAV_ROUTES) || '[]'); }
function saveFavRoutes(d) { localStorage.setItem(DB.FAV_ROUTES, JSON.stringify(d)); }

function addFavRoute(route) {
  const favs = getFavRoutes();
  favs.unshift({
    id:       Date.now(),
    name:     route.name || 'お気に入りルート',
    dist:     route.dist,
    duration: route.duration,
    points:   route.points,
    color:    route.color || '#4ECDC4',
    savedAt:  new Date().toISOString(),
  });
  saveFavRoutes(favs.slice(0, 20)); // 最大20件
  updateFavRoutesUI();
}
function deleteFavRoute(id) {
  saveFavRoutes(getFavRoutes().filter(r => r.id !== id));
  updateFavRoutesUI();
}

// ---- お気に入りルートUI更新 ----
function updateFavRoutesUI() {
  const listDiv = document.getElementById('fav-routes-list');
  if (!listDiv) return;
  const favs = getFavRoutes();
  if (!favs.length) {
    listDiv.innerHTML = '<p class="text-muted">まだお気に入りが登録されていません</p>';
    return;
  }
  listDiv.innerHTML = favs.map(r => `
    <div class="saved-spot fav-route-item" id="fav-${r.id}">
      <div class="saved-spot-info" onclick="startFavRoute(${r.id})" style="cursor:pointer;">
        <div class="saved-spot-name">⭐ ${escapeHtml(r.name)}</div>
        <div class="saved-spot-addr">${escapeHtml(r.dist)}km &nbsp;|&nbsp; 約${escapeHtml(String(r.duration))}分 &nbsp;|&nbsp; ${new Date(r.savedAt).toLocaleDateString('ja-JP')}</div>
      </div>
      <button class="saved-spot-del" onclick="deleteFavRoute(${r.id})" title="削除">🗑️</button>
    </div>
  `).join('');
}

// ---- ログ操作 ----
function addLog(entry) {
  const logs = getLogs();
  logs.unshift(entry);
  saveLogs(logs.slice(0, 200));
}

function saveLogs(d) {
  // 容量超過時は古いログから10件ずつ削除して再試行
  try {
    localStorage.setItem(DB.LOGS, JSON.stringify(d));
  } catch (e) {
    if (d.length > 10) {
      saveLogs(d.slice(0, d.length - 10));
    }
    // 10件以下でも失敗する場合はそれ以上削除しない(最新データを守る)
  }
}
function deleteLogEntry(idx) {
  const logs = getLogs();
  logs.splice(idx, 1);
  saveLogs(logs);
}

// ---- スポットUI更新(ホーム + 設定タブ共通) ----
function updateSpotsUI() {
  const spots = getSpots();
  const sel = document.getElementById('spot-selector');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- スポットを選んでください --</option>';
    spots.forEach(s => {
      sel.innerHTML += `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
    });
    if (prev) sel.value = prev;
    const hasSpot = !!sel.value;
    const btnSuggest  = document.getElementById('btn-suggest');
    const btnFreeWalk = document.getElementById('btn-free-walk');
    if (btnSuggest)  btnSuggest.disabled  = !hasSpot;
    if (btnFreeWalk) btnFreeWalk.disabled = !hasSpot;
  }

  const listDiv = document.getElementById('spots-list-settings');
  if (!listDiv) return;
  if (!spots.length) {
    listDiv.innerHTML = '<p class="text-muted">まだ地点が登録されていません</p>';
    return;
  }
  listDiv.innerHTML = spots.map(s => `
    <div class="saved-spot">
      <div class="saved-spot-info">
        <div class="saved-spot-name">📍 ${escapeHtml(s.name)}</div>
        ${s.address ? `<div class="saved-spot-addr">${escapeHtml(s.address)}</div>` : ''}
      </div>
      <button class="saved-spot-del" onclick="deleteSpot(${s.id})" title="削除">🗑️</button>
    </div>
  `).join('');
}
