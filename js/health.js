/* ============================================================
   health.js — 健康管理・グラフ・ゲーミフィケーション
============================================================ */

// ================================================================
// 実績バッジ定義
// ================================================================
const ACHIEVEMENTS = [
  { id: 'first_walk',   icon: '🐾', name: '初散歩',     desc: '初めてのお散歩',          check: (logs) => logs.length >= 1 },
  { id: 'early_bird',   icon: '🌅', name: '早起き',     desc: '朝6時前に散歩完了',        check: (logs) => logs.some(l => new Date(l.date).getHours() < 6) },
  { id: 'rain_walker',  icon: '🌧️', name: '雨の日も',   desc: '雨天で5回散歩',           check: (logs) => logs.filter(l => l.weather && l.weather >= 51).length >= 5 },
  { id: 'dist_10',      icon: '📏', name: '10km',       desc: '累計10km達成',            check: (logs) => logs.reduce((s,l) => s + l.distance, 0) >= 10000 },
  { id: 'dist_50',      icon: '🥈', name: '50km',       desc: '累計50km達成',            check: (logs) => logs.reduce((s,l) => s + l.distance, 0) >= 50000 },
  { id: 'dist_100',     icon: '🥇', name: '100km',      desc: '累計100km達成',           check: (logs) => logs.reduce((s,l) => s + l.distance, 0) >= 100000 },
  { id: 'streak_3',     icon: '🔥', name: '3日連続',    desc: '3日連続で散歩',           check: (logs) => getStreak(logs) >= 3 },
  { id: 'streak_7',     icon: '🔥🔥', name: '1週間',   desc: '7日連続で散歩',           check: (logs) => getStreak(logs) >= 7 },
  { id: 'streak_30',    icon: '💫', name: '1ヶ月',      desc: '30日連続で散歩',          check: (logs) => getStreak(logs) >= 30 },
  { id: 'many_dogs',    icon: '🐶', name: '犬友',       desc: '10匹とすれ違い',          check: (logs) => logs.reduce((s,l) => s + (l.dogs||0), 0) >= 10 },
  { id: 'night_walk',   icon: '🌙', name: '夜のお散歩', desc: '21時以降に散歩',          check: (logs) => logs.some(l => new Date(l.date).getHours() >= 21) },
  { id: 'long_walk',    icon: '🗺️', name: '大冒険',     desc: '1回で5km以上歩く',        check: (logs) => logs.some(l => l.distance >= 5000) },
];

function getStreak(logs) {
  if (!logs.length) return 0;
  const days = new Set(logs.map(l => l.date.slice(0, 10)));
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function checkNewAchievements(newEntry) {
  const logs  = getLogs();
  const stored = JSON.parse(localStorage.getItem('wanpo_achievements') || '[]');
  const newBadges = [];
  ACHIEVEMENTS.forEach(a => {
    if (!stored.includes(a.id) && a.check(logs)) {
      stored.push(a.id);
      newBadges.push(a);
    }
  });
  localStorage.setItem('wanpo_achievements', JSON.stringify(stored));
  return newBadges;
}

function getUnlockedAchievements() {
  return JSON.parse(localStorage.getItem('wanpo_achievements') || '[]');
}

// ================================================================
// 健康タブ描画
// ================================================================
function renderHealthTab() {
  const logs     = getLogs();
  const unlocked = getUnlockedAchievements();
  const streak   = getStreak(logs);
  const now      = new Date();

  // ストリーク
  document.getElementById('streak-count').textContent = streak;
  document.getElementById('month-walks').textContent  =
    logs.filter(l => {
      const d = new Date(l.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

  // ステータス
  document.getElementById('stat-total-walks').textContent    = logs.length;
  document.getElementById('stat-total-distance').textContent = (logs.reduce((s,l) => s + l.distance, 0) / 1000).toFixed(1);
  document.getElementById('stat-total-pee').textContent      = logs.reduce((s,l) => s + (l.toiletPee||0), 0);
  document.getElementById('stat-total-poo').textContent      = logs.reduce((s,l) => s + (l.toiletPoo||0), 0);

  // 週間カレンダー
  renderWeekCal(logs);

  // トイレグラフ(Canvas)
  renderToiletChart(logs);

  // 最後のうんち表示
  renderLastPoo(logs);

  // すれ違い犬の履歴
  renderDogEncounterHistory(logs);

  // 実績バッジ
  renderAchievementBadges(unlocked);
}

function renderWeekCal(logs) {
  const cal  = document.getElementById('week-cal');
  const days = ['日','月','火','水','木','金','土'];
  const now  = new Date();
  let html   = '';

  for (let i = 6; i >= 0; i--) {
    const d   = new Date(now); d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const has = logs.some(l => l.date.slice(0,10) === key);
    const isToday = (i === 0);
    const cls = has ? 'has-walk' : (isToday ? 'today' : '');
    html += `
      <div class="week-day">
        <div class="week-day-label">${days[d.getDay()]}</div>
        <div class="week-day-dot ${cls}">${d.getDate()}</div>
      </div>`;
  }
  cal.innerHTML = html;
}

function renderToiletChart(logs) {
  const canvas = document.getElementById('toilet-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W   = canvas.offsetWidth || 300;
  canvas.width  = W * window.devicePixelRatio;
  canvas.height = 120 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const cw = W, ch = 120;

  // 直近7日データ集計
  const now  = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d   = new Date(now); d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const ls  = logs.filter(l => l.date.slice(0,10) === key);
    days.push({
      label: `${d.getDate()}日`,
      pee:   ls.reduce((s,l) => s + (l.toiletPee||0), 0),
      poo:   ls.reduce((s,l) => s + (l.toiletPoo||0), 0),
    });
  }

  const maxVal = Math.max(...days.map(d => d.pee + d.poo), 1);
  const padL = 30, padR = 10, padT = 10, padB = 24;
  const chartW = cw - padL - padR;
  const chartH = ch - padT - padB;
  const barW   = chartW / 7 * 0.6;
  const barGap = chartW / 7;

  ctx.clearRect(0, 0, cw, ch);

  // グリッドライン
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 1;
  for (let g = 0; g <= 4; g++) {
    const y = padT + chartH - (g / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
  }

  days.forEach((d, i) => {
    const x    = padL + i * barGap + barGap * 0.2;
    const totH = ((d.pee + d.poo) / maxVal) * chartH;
    const peeH = (d.pee / maxVal) * chartH;
    const pooH = (d.poo / maxVal) * chartH;

    // pee bar (上部)
    if (d.pee > 0) {
      const grad = ctx.createLinearGradient(0, padT + chartH - totH, 0, padT + chartH - pooH);
      grad.addColorStop(0, '#4A9EE3');
      grad.addColorStop(1, '#2471a3');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, padT + chartH - totH, barW, peeH, [4, 4, 0, 0]);
      ctx.fill();
    }
    // poo bar (下部)
    if (d.poo > 0) {
      const grad = ctx.createLinearGradient(0, padT + chartH - pooH, 0, padT + chartH);
      grad.addColorStop(0, '#A0785A');
      grad.addColorStop(1, '#7d5a45');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, padT + chartH - pooH, barW, pooH, (d.pee === 0 ? [4,4,0,0] : [0,0,0,0]));
      ctx.fill();
    }

    // 日付ラベル
    ctx.fillStyle = 'rgba(232,234,240,0.4)';
    ctx.font      = `${10 * (W/300)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(d.label, x + barW/2, ch - 4);
  });

  // 凡例
  ctx.textAlign = 'left';
  ctx.font      = '10px -apple-system, sans-serif';
  ctx.fillStyle = '#4A9EE3';
  ctx.fillText('💧おしっこ', padL, padT + 10);
  ctx.fillStyle = '#A0785A';
  ctx.fillText('💩うんち', padL + 80, padT + 10);
}

function renderAchievementBadges(unlocked) {
  const grid = document.getElementById('achievement-grid');
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const isOn = unlocked.includes(a.id);
    return `
      <div class="card achievement-badge ${isOn ? 'unlocked' : 'locked'}">
        <div class="card-glow"></div>
        <span class="badge-icon">${a.icon}</span>
        <div class="badge-name">${a.name}</div>
        <div class="badge-desc">${a.desc}</div>
      </div>`;
  }).join('');
}

// ================================================================
// 最後のうんち表示
// ================================================================
function renderLastPoo(logs) {
  const banner = document.getElementById('last-poo-banner');
  if (!banner) return;

  // 全ログのうんち記録から最新を探す
  // toiletMarkers の time は散歩ログの date (ISO) から推定するしかないため
  // log.date (散歩終了時刻) を最後のうんち記録日時として扱う
  const lastPooLog = logs.find(l => (l.toiletPoo || 0) > 0);

  if (!lastPooLog) {
    banner.innerHTML = '<span>💩</span><span>うんちの記録がまだありません</span>';
    return;
  }

  const lastDate  = new Date(lastPooLog.date);
  const now       = new Date();
  const diffMs    = now - lastDate;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins  = Math.floor(diffMs / (1000 * 60));

  // 経過時間テキスト
  let elapsedText;
  if (diffMins < 60)        elapsedText = `${diffMins}分前`;
  else if (diffHours < 24)  elapsedText = `${diffHours}時間前`;
  else                      elapsedText = `${Math.floor(diffHours / 24)}日前`;

  // 色クラス: 24h以内=green / 48h以内=yellow / それ以上=red
  const colorClass = diffHours < 24 ? 'fresh' : diffHours < 48 ? 'normal' : 'long';

  // 日時フォーマット
  const dateStr = `${lastDate.getMonth()+1}/${lastDate.getDate()} ${String(lastDate.getHours()).padStart(2,'0')}:${String(lastDate.getMinutes()).padStart(2,'0')}`;

  banner.innerHTML = `
    <span>💩</span>
    <span>最後のうんち <strong>${dateStr}</strong></span>
    <span class="poo-elapsed ${colorClass}">${elapsedText}</span>
  `;
}

// ================================================================
// すれ違い犬の履歴
// ================================================================
function renderDogEncounterHistory(logs) {
  const container = document.getElementById('dog-encounter-history');
  if (!container) return;

  // 全ログからすれ違い犬を抽出・日付でグループ化
  const grouped = {};
  logs.forEach(log => {
    if (!log.dogs || log.dogs === 0) return;
    const dateKey = log.date.slice(0, 10); // YYYY-MM-DD
    if (!grouped[dateKey]) grouped[dateKey] = [];

    const breeds = log.dogBreeds && log.dogBreeds.length
      ? log.dogBreeds
      : Array(log.dogs).fill('不明');

    const logDate = new Date(log.date);
    const timeStr = `${String(logDate.getHours()).padStart(2,'0')}:${String(logDate.getMinutes()).padStart(2,'0')}`;

    breeds.forEach(breed => {
      grouped[dateKey].push({ breed, time: timeStr });
    });
  });

  const sortedDays = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (!sortedDays.length) {
    container.innerHTML = '<p class="text-muted">まだ記録がありません</p>';
    return;
  }

  const days = ['日','月','火','水','木','金','土'];
  container.innerHTML = sortedDays.map(dateKey => {
    const d       = new Date(dateKey);
    const dayLabel = `${d.getMonth()+1}月${d.getDate()}日(${days[d.getDay()]})`;
    const items   = grouped[dateKey];

    return `
      <div class="dog-enc-day">
        <div class="dog-enc-day-label">${dayLabel} — ${items.length}匹</div>
        ${items.map(enc => `
          <div class="dog-enc-item">
            <span>🐶</span>
            <span class="dog-enc-breed">${escapeHtml(enc.breed)}</span>
            <span class="dog-enc-time">散歩終了 ${enc.time}</span>
          </div>
        `).join('')}
      </div>`;
  }).join('');
}

// ================================================================
// 愛犬プロフィール
// ================================================================
function saveDogProfile() {
  const name    = document.getElementById('dog-name')?.value || '';
  const breed   = document.getElementById('dog-breed')?.value || '';
  const weight  = document.getElementById('dog-weight')?.value || '';
  const bday    = document.getElementById('dog-birthday')?.value || '';
  localStorage.setItem(DB.DOG, JSON.stringify({ name, breed, weight, bday }));

  // ホームロゴに名前を反映
  if (name) {
    const logo = document.querySelector('.home-logo');
    if (logo) logo.textContent = `🐾 ${name}のわんポナビ`;
  }
  showToast(`✅ ${name || '愛犬'}のプロフィールを保存しました!`);
}

function loadDogProfile() {
  const p = getDogProfile();
  if (document.getElementById('dog-name'))     document.getElementById('dog-name').value     = p.name    || '';
  if (document.getElementById('dog-breed'))    document.getElementById('dog-breed').value    = p.breed   || '';
  if (document.getElementById('dog-weight'))   document.getElementById('dog-weight').value   = p.weight  || '';
  if (document.getElementById('dog-birthday')) document.getElementById('dog-birthday').value = p.bday    || '';
  if (p.name) {
    const logo = document.querySelector('.home-logo');
    if (logo) logo.textContent = `🐾 ${p.name}のわんポナビ`;
  }
}
