// Storage helpers
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

// State
let habits  = load('habits', []);    // [{ id, name }]
let records = load('records', {});   // { "YYYY-MM-DD": { habitId: bool } }

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Persist
function saveAll() {
  save('habits', habits);
  save('records', records);
}

// Streak calculation: consecutive days ending on yesterday (or today if checked)
function computeStreak(habitId) {
  const t = today();
  const days = Object.keys(records).sort();
  if (!days.length) return 0;

  // Build a set of dates this habit was checked
  const checked = new Set(days.filter(d => records[d]?.[habitId]));

  // Walk backwards from today
  let streak = 0;
  let cur = new Date(t + 'T00:00:00');
  while (true) {
    const iso = cur.toISOString().slice(0, 10);
    if (checked.has(iso)) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    } else {
      // Allow today to be incomplete without breaking the streak
      if (iso === t && streak === 0) {
        cur.setDate(cur.getDate() - 1);
        // check yesterday; if not checked, streak is 0
        const yIso = cur.toISOString().slice(0, 10);
        if (!checked.has(yIso)) break;
      } else {
        break;
      }
    }
  }
  return streak;
}

const MILESTONES = [
  { days: 365, cls: 'level-365', text: '🌟 Legendary! 365-day streak — you\'ve made this a true part of who you are. That\'s extraordinary discipline.' },
  { days: 31,  cls: 'level-31',  text: '🔥 A full month! 31 days strong — science says habits are now wired in. Keep the chain alive!' },
  { days: 14,  cls: 'level-14',  text: '⚡ Two weeks in! 14-day streak — you\'re past the hardest part. Momentum is yours now.' },
  { days:  7,  cls: 'level-7',   text: '✨ First week done! 7-day streak — you\'re building something real. Keep it going!' },
];

function getMilestone(streak) {
  return MILESTONES.find(m => streak >= m.days) ?? null;
}

function streakClass(streak) {
  if (streak >= 365) return 'fire-365';
  if (streak >= 31)  return 'fire-31';
  if (streak >= 14)  return 'fire-14';
  if (streak >= 7)   return 'fire-7';
  return '';
}

// Next milestone info for progress bar
function nextMilestone(streak) {
  const targets = [7, 14, 31, 365];
  const next = targets.find(t => t > streak);
  if (!next) return { target: 365, pct: 100 };
  const prev = targets[targets.indexOf(next) - 1] ?? 0;
  const pct = Math.round(((streak - prev) / (next - prev)) * 100);
  return { target: next, pct };
}

// === Render helpers ===

function renderMain() {
  const list   = document.getElementById('habit-list');
  const empty  = document.getElementById('empty-main');
  const todayStr = today();

  document.getElementById('today-date').textContent = dateLabel(todayStr);

  if (!habits.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = habits.map(h => {
    const checked = records[todayStr]?.[h.id] ?? false;
    return `<li class="habit-item${checked ? ' checked' : ''}" data-id="${h.id}">
      <span class="habit-checkbox">${checked ? '✓' : ''}</span>
      <span class="habit-name">${escHtml(h.name)}</span>
    </li>`;
  }).join('');

  list.querySelectorAll('.habit-item').forEach(el => {
    el.addEventListener('click', () => toggleHabit(el.dataset.id));
  });
}

function renderStats() {
  const list  = document.getElementById('streak-list');
  const empty = document.getElementById('empty-stats');

  if (!habits.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = habits.map(h => {
    const streak = computeStreak(h.id);
    const sc     = streakClass(streak);
    const ms     = getMilestone(streak);
    const { target, pct } = nextMilestone(streak);
    const label  = streak === 1 ? '1 day streak' : `${streak} day streak`;
    const nextLbl = streak < 365 ? `${pct}% to ${target}-day milestone` : 'Max milestone reached!';

    // Last 28 days mini heatmap
    const cells = Array.from({ length: 28 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (27 - i));
      const iso = d.toISOString().slice(0, 10);
      const on  = records[iso]?.[h.id] ? 'on' : '';
      return `<span class="grid-cell ${on}"></span>`;
    }).join('');

    const milestoneHtml = ms
      ? `<div class="streak-milestone ${ms.cls}">${ms.text}</div>`
      : '';

    return `<li class="streak-card">
      <div class="streak-header">
        <span class="streak-name">${escHtml(h.name)}</span>
        <div style="text-align:right">
          <div class="streak-count ${sc}">${streak}</div>
          <div class="streak-label">${streak === 1 ? 'day' : 'days'}</div>
        </div>
      </div>
      <div class="streak-bar-track"><div class="streak-bar-fill" style="width:${pct}%"></div></div>
      <div class="streak-label">${nextLbl}</div>
      <div class="streak-grid">${cells}</div>
      ${milestoneHtml}
    </li>`;
  }).join('');
}

function renderSettings() {
  const list  = document.getElementById('settings-habit-list');
  const empty = document.getElementById('empty-settings');

  if (!habits.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = habits.map(h => `
    <li class="settings-item">
      <span class="habit-name">${escHtml(h.name)}</span>
      <button class="btn-delete" data-id="${h.id}">Delete</button>
    </li>`).join('');

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteHabit(btn.dataset.id));
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// === Actions ===

function toggleHabit(id) {
  const todayStr = today();
  if (!records[todayStr]) records[todayStr] = {};
  records[todayStr][id] = !records[todayStr][id];
  saveAll();
  renderMain();
}

function addHabit(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  habits.push({ id: uid(), name: trimmed });
  saveAll();
  renderSettings();
  renderMain();
  renderStats();
}

function deleteHabit(id) {
  if (!confirm('Delete this habit? All its history will be removed.')) return;
  habits = habits.filter(h => h.id !== id);
  // Purge from records
  for (const day of Object.keys(records)) {
    delete records[day][id];
  }
  saveAll();
  renderSettings();
  renderMain();
  renderStats();
}

// === Navigation ===

const views = { main: 'view-main', stats: 'view-stats', settings: 'view-settings' };

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(views[name]).classList.add('active');
  document.querySelector(`.nav-btn[data-view="${name}"]`).classList.add('active');

  if (name === 'main')     renderMain();
  if (name === 'stats')    renderStats();
  if (name === 'settings') renderSettings();
}

// === Init ===

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('add-habit-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('new-habit-name');
  addHabit(input.value);
  input.value = '';
});

// Initial render
renderMain();
