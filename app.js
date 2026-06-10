// Storage helpers
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

// State
let habits      = [];
let records     = {};
let currentUser = null;

// ========== Crypto helpers (PBKDF2 via Web Crypto API) ==========

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function genSalt() {
  return bufToHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveKey(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return bufToHex(bits);
}

// ========== Auth storage ==========

function loadUsers() { return load('auth_users', {}); }
function saveUsers(users) { save('auth_users', users); }

// ========== Session (sessionStorage — clears on tab close) ==========

function getSession()         { return sessionStorage.getItem('session_user'); }
function setSession(username) { sessionStorage.setItem('session_user', username); }
function clearSession()       { sessionStorage.removeItem('session_user'); }

// ========== Per-user data ==========

function loadUserData(username) {
  currentUser = username;
  habits  = load(`${username}_habits`, []);
  records = load(`${username}_records`, {});
}

// Persist
function saveAll() {
  save(`${currentUser}_habits`, habits);
  save(`${currentUser}_records`, records);
}

// ========== DOM toggles ==========

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').hidden = true;
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').hidden = false;
}

function setAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.hidden = !msg;
}

// ========== Auth handlers ==========

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  setAuthError('login-error', '');

  if (!username || !password) {
    setAuthError('login-error', 'Username and password are required.');
    return;
  }

  const btn = document.getElementById('login-submit');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Logging in…';

  try {
    const users = loadUsers();
    if (!users[username]) {
      setAuthError('login-error', 'No account found with that username.');
      return;
    }
    const hash = await deriveKey(password, users[username].salt);
    if (hash !== users[username].hash) {
      setAuthError('login-error', 'Incorrect password.');
      return;
    }
    setSession(username);
    loadUserData(username);
    showApp();
    showView('main');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;

  setAuthError('reg-error', '');

  if (!username || !password) {
    setAuthError('reg-error', 'Username and password are required.');
    return;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(username)) {
    setAuthError('reg-error', 'Username may only contain letters, numbers, _ and -.');
    return;
  }

  const users = loadUsers();
  if (users[username]) {
    setAuthError('reg-error', 'That username is already taken.');
    return;
  }

  const btn = document.getElementById('reg-submit');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    const salt = genSalt();
    const hash = await deriveKey(password, salt);
    users[username] = { salt, hash };
    saveUsers(users);
    setSession(username);
    loadUserData(username);
    showApp();
    showView('main');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function handleLogout() {
  clearSession();
  currentUser = null;
  habits  = [];
  records = {};
  showAuth();
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  setAuthError('login-error', '');
  setAuthError('reg-error', '');
}

// ========== Date helpers ==========

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

// ========== Streak logic ==========

function computeStreak(habitId) {
  const t = today();
  const days = Object.keys(records).sort();
  if (!days.length) return 0;

  const checked = new Set(days.filter(d => records[d]?.[habitId]));

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

function nextMilestone(streak) {
  const targets = [7, 14, 31, 365];
  const next = targets.find(t => t > streak);
  if (!next) return { target: 365, pct: 100 };
  const prev = targets[targets.indexOf(next) - 1] ?? 0;
  const pct = Math.round(((streak - prev) / (next - prev)) * 100);
  return { target: next, pct };
}

// ========== Render helpers ==========

function renderMain() {
  const list     = document.getElementById('habit-list');
  const empty    = document.getElementById('empty-main');
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
    const nextLbl = streak < 365 ? `${pct}% to ${target}-day milestone` : 'Max milestone reached!';

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

// ========== Actions ==========

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
  for (const day of Object.keys(records)) delete records[day][id];
  saveAll();
  renderSettings();
  renderMain();
  renderStats();
}

// ========== Navigation ==========

const views = { main: 'view-main', stats: 'view-stats', settings: 'view-settings' };

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  document.getElementById(views[name]).classList.add('active');
  document.querySelector(`.nav-btn[data-view="${name}"]`).classList.add('active');

  if (name === 'main')     renderMain();
  if (name === 'stats')    renderStats();
  if (name === 'settings') renderSettings();
}

// ========== Init ==========

// Auth tab toggle
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('login-form').hidden = !isLogin;
    document.getElementById('register-form').hidden = isLogin;
    setAuthError('login-error', '');
    setAuthError('reg-error', '');
  });
});

document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('register-form').addEventListener('submit', handleRegister);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

// Nav (data-view selector excludes the logout button)
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('add-habit-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('new-habit-name');
  addHabit(input.value);
  input.value = '';
});

// Boot: restore session or show auth screen
const existingSession = getSession();
if (existingSession) {
  loadUserData(existingSession);
  showApp();
  showView('main');
} else {
  showAuth();
}
