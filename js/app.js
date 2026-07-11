/* ============================================================
   app.js — 画面管理・初期化・グローバルユーティリティ
============================================================ */

// ================================================================
// 画面切り替え
// ================================================================
const NAV_MAP = { home:0, route:1, health:2, log:3, settings:4 };

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const screen = document.getElementById(`screen-${name}`);
  if (screen) screen.classList.add('active');

  const navItems = document.querySelectorAll('.nav-item');
  const idx      = NAV_MAP[name];
  if (idx !== undefined && navItems[idx]) navItems[idx].classList.add('active');

  // 背景画像: ホーム・ルート画面でのみ表示
  if (name === 'home' || name === 'route') {
    document.body.classList.add('show-bg');
  } else {
    document.body.classList.remove('show-bg');
  }

  // 画面別後処理
  if (name === 'walk' && map) setTimeout(() => map.invalidateSize(), 150);
  if (name === 'route') setTimeout(() => minimaps.forEach(m => m?.invalidateSize()), 150);
  if (name === 'log')    renderLog();
  if (name === 'health') renderHealthTab();
  if (name === 'settings') {
    initRegisterMap();
    setTimeout(() => registerMap?.invalidateSize(), 300);
  }
}

// ================================================================
// 時計
// ================================================================
function updateClock() {
  const now  = new Date();
  const days = ['日','月','火','水','木','金','土'];
  const h    = String(now.getHours()).padStart(2, '0');
  const m    = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent       = `${h}:${m}`;
  document.getElementById('date-display').textContent =
    `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日(${days[now.getDay()]})`;
}
setInterval(updateClock, 1000);
updateClock();

// ================================================================
// 時間ピル選択
// ================================================================
document.getElementById('time-selector').addEventListener('click', e => {
  const pill = e.target.closest('.time-pill');
  if (!pill) return;
  document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  selectedMinutes = parseInt(pill.dataset.minutes);
});

// スポット選択 → ボタン活性 (提案ボタン + フリー散歩ボタン両方)
document.getElementById('spot-selector').addEventListener('change', () => {
  const hasSpot = !!document.getElementById('spot-selector').value;
  const btnSuggest  = document.getElementById('btn-suggest');
  const btnFreeWalk = document.getElementById('btn-free-walk');
  if (btnSuggest)  btnSuggest.disabled  = !hasSpot;
  if (btnFreeWalk) btnFreeWalk.disabled = !hasSpot;
});

// ================================================================
// ログ画面描画
// ================================================================
function renderLog() {
  const logs = getLogs();

  document.getElementById('log-stat-walks').textContent    = logs.length;
  document.getElementById('log-stat-distance').textContent =
    (logs.reduce((s,l) => s + l.distance, 0) / 1000).toFixed(1);

  const listDiv = document.getElementById('log-list');
  if (!logs.length) {
    listDiv.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🐾</div>
        <p>まだ散歩ログがありません<br>お散歩に行きましょう!</p>
      </div>`;
    return;
  }

  listDiv.innerHTML = logs.slice(0, 50).map((log, idx) => {
    const d    = new Date(log.date);
    const days = ['日','月','火','水','木','金','土'];
    const dateStr = `${d.getMonth()+1}/${d.getDate()}(${days[d.getDay()]})`;
    const timeStr = `${Math.floor(log.duration/60)}分 / ${(log.distance/1000).toFixed(2)}km`;

    return `
      <div class="card log-entry">
        <div class="card-glow"></div>
        <div class="log-entry-inner">
          <div class="log-entry-head">
            <span class="log-entry-date">🗓️ ${dateStr}</span>
            <span style="display:flex;align-items:center;gap:8px;">
              <span class="log-entry-time">${timeStr}</span>
              <button class="log-delete-btn" onclick="deleteLogEntry(${idx});renderLog();">🗑️</button>
            </span>
          </div>
          <div class="log-entry-meta">
            ${log.mode === 'free' ? '<span class="log-entry-tag">🐾 フリー</span>' : log.mode === 'fav' ? '<span class="log-entry-tag">⭐ お気に入り</span>' : ''}
            <span class="log-entry-tag">🐶 ${log.dogs||0}匹</span>
            <span class="log-entry-tag">💧 ${log.toiletPee||0}回</span>
            <span class="log-entry-tag">💩 ${log.toiletPoo||0}回</span>
            ${log.wbgt ? `<span class="log-entry-tag">🌡️ WBGT ${log.wbgt}°</span>` : ''}
            ${log.dogBreeds?.length ? `<span class="log-entry-tag">(${log.dogBreeds.map(b => escapeHtml(b)).join(', ')})</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ================================================================
// データ削除
// ================================================================
function clearAllLogs() {
  const logs = getLogs();
  if (!logs.length) { showToast('削除するログがありません'); return; }
  if (!confirm(`⚠️ ${logs.length}件の散歩ログを全て削除しますか?`)) return;
  localStorage.removeItem(DB.LOGS);
  renderLog();
  showToast('✅ 全ログを削除しました');
}

function clearAllData() {
  if (!confirm('⚠️ 全データを削除します。よろしいですか?')) return;
  if (!confirm('本当に全て消しますか?')) return;
  [DB.SPOTS, DB.LOGS, DB.DOG, DB.SETTINGS, DB.FAV_ROUTES, 'wanpo_achievements'].forEach(k => localStorage.removeItem(k));
  updateSpotsUI();
  updateFavRoutesUI();
  renderLog();
  showToast('✅ 全データを削除しました');
}

// ================================================================
// トースト通知
// ================================================================
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
      background: 'linear-gradient(135deg, rgba(30,35,50,0.97), rgba(20,25,40,0.97))',
      color: '#e8eaf0', padding: '12px 24px', borderRadius: '24px',
      fontSize: '14px', fontWeight: '600', fontFamily: 'var(--font, sans-serif)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
      zIndex: '9999', whiteSpace: 'nowrap',
      transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      opacity: '0', pointerEvents: 'none',
      backdropFilter: 'blur(12px)', webkitBackdropFilter: 'blur(12px)',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2800);
}

// ================================================================
// 初期化
// ================================================================
function init() {
  // 初期画面はホームなので背景ON
  document.body.classList.add('show-bg');

  updateSpotsUI();
  updateFavRoutesUI();
  loadDogProfile();
  loadSettingsToggles();

  // 天気取得: 登録済みスポット → GPS → フォールバック(大阪)
  const spots = getSpots();
  if (spots.length) {
    fetchWeather(spots[0].lat, spots[0].lng);
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p  => fetchWeather(p.coords.latitude, p.coords.longitude),
      () => fetchWeather(34.6937, 135.5023)
    );
  } else {
    fetchWeather(34.6937, 135.5023);
  }
}

// ================================================================
// 設定トグル — 読み込みと保存
// ================================================================
function loadSettingsToggles() {
  const s = getSettings();
  const map = {
    'setting-avoid-busy':    'avoidBusy',
    'setting-prefer-green':  'preferGreen',
    'setting-loop':          'loop',
    'setting-water':         'water',
  };
  Object.entries(map).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) el.checked = !!s[key];
  });
}

function onSettingToggle() {
  const map = {
    'setting-avoid-busy':    'avoidBusy',
    'setting-prefer-green':  'preferGreen',
    'setting-loop':          'loop',
    'setting-water':         'water',
  };
  const s = getSettings();
  Object.entries(map).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) s[key] = el.checked;
  });
  saveSettings(s);
}

// トグル変更イベントを登録
['setting-avoid-busy','setting-prefer-green','setting-loop','setting-water'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', onSettingToggle);
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
