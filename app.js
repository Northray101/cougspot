/* ════════════════════════════════════════════
   CougSpot — Dashboard App
   ════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://dqcyecscdelfikbimnpw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3llY3NjZGVsZmlrYmltbnB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzIwOTUsImV4cCI6MjA5Mzc0ODA5NX0.PIl0Syj--UQNjtMKNjAWmisYwOA50Aw5ICNv6J-UNDQ';
const SITE_PIN      = '2345';
const ADMIN_PIN     = '0316';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── Bell Schedules ── */
const SCHEDULE_STANDARD = [
  { name: 'Period 1', start: '08:30', end: '09:27' },
  { name: 'Period 2', start: '09:35', end: '10:34' },
  { name: 'Period 3', start: '10:42', end: '11:37' },
  { name: 'Period 4', start: '11:45', end: '12:44' },
  { name: 'Lunch',    start: '12:44', end: '13:24' },
  { name: 'Period 5', start: '13:32', end: '14:29' },
  { name: 'Period 6', start: '14:37', end: '15:34' },
];
const SCHEDULE_WEDNESDAY = [
  { name: 'Period 1', start: '09:50', end: '10:34' },
  { name: 'Period 2', start: '10:42', end: '11:26' },
  { name: 'Period 3', start: '11:34', end: '12:18' },
  { name: 'Period 4', start: '12:26', end: '13:10' },
  { name: 'Lunch',    start: '13:10', end: '13:50' },
  { name: 'Period 5', start: '13:58', end: '14:42' },
  { name: 'Period 6', start: '14:50', end: '15:34' },
];
function getTodaySchedule() {
  const d = new Date().getDay();
  if (d === 0 || d === 6) return null;
  return d === 3 ? SCHEDULE_WEDNESDAY : SCHEDULE_STANDARD;
}

/* ── State ── */
let currentUser   = null;
Object.defineProperty(window, 'currentUser', {
  get() { return currentUser; },
  set(v) { currentUser = v; },
  configurable: true,
});
let currentPin    = '';
let pinTarget     = null;
let adminUnlocked = false;
let announceChannel = null;
let clockCollapsed  = false;

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.addEventListener('load', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    enterHome();
  } else {
    showScreen('landing');
  }
  startClock();
  subscribeAnnouncements();
});

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
  } else if (event === 'SIGNED_OUT') {
    currentUser = null;
    adminUnlocked = false;
    showScreen('landing');
  }
});

/* ════════════════════════════════════════════
   SCREEN ROUTER
════════════════════════════════════════════ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

function enterHome() {
  showScreen('home');
  const uname = currentUser?.user_metadata?.username || '?';
  const init  = uname.slice(0, 2).toUpperCase();
  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.textContent = init;
  const socAvatar = document.getElementById('nav-soc-avatar');
  if (socAvatar) {
    const inner = socAvatar.querySelector('.soc-avatar');
    if (inner) inner.textContent = init;
  }
  initHomeGreeting(uname === '?' ? null : uname);
  loadDashboardStats();
  loadLatestAnnouncement();
  subscribeAnnouncements();
  if (window.SocialLayer && typeof window.SocialLayer.init === 'function') {
    window.SocialLayer.init();
  }
}

/* ════════════════════════════════════════════
   AUTH
════════════════════════════════════════════ */
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  if (!username || !password) { showErr(err, 'Fill in all fields.'); return; }
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled  = true;
  const email = username.toLowerCase().replace(/[^a-z0-9]/g,'') + '@cougspot.app';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled  = false;
  btn.textContent = 'Sign in';
  if (error) { showErr(err, 'Username or password is incorrect.'); return; }
  hideErr(err);
  closeModal('login');
  currentUser = data.user;
  enterHome();
  toast('Signed in.', 'success');
}

function startSignup() {
  pinTarget  = 'signup';
  currentPin = '';
  document.getElementById('pin-gate-title').textContent = 'Enter site PIN';
  document.getElementById('pin-gate-sub').textContent   = 'This site is invite-only. Enter the PIN to continue.';
  document.getElementById('pin-gate-error').classList.remove('show');
  updatePinDots('pg');
  openModal('pin-gate');
}

async function doSignup() {
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const btn = document.getElementById('signup-btn');
  const err = document.getElementById('signup-error');
  if (!username || !password) { showErr(err, 'Fill in all fields.'); return; }
  if (username.length < 3)    { showErr(err, 'Username must be at least 3 characters.'); return; }
  if (password.length < 8)    { showErr(err, 'Password must be at least 8 characters.'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) { showErr(err, 'Letters, numbers, and underscores only.'); return; }
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled  = true;
  const email = username.toLowerCase().replace(/[^a-z0-9]/g,'') + '@cougspot.app';
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { username }, emailRedirectTo: null }
  });
  btn.disabled  = false;
  btn.textContent = 'Create account';
  if (error) { showErr(err, error.message); return; }
  hideErr(err);
  closeModal('signup');
  if (data.session) {
    currentUser = data.user;
    enterHome();
    toast('Welcome to CougSpot.', 'success');
  } else {
    openModal('login');
    toast('Account created. Sign in to continue.', 'success');
  }
}

async function signOut() {
  if (announceChannel) sb.removeChannel(announceChannel);
  await sb.auth.signOut();
  toast('Signed out.', '');
}

/* ════════════════════════════════════════════
   PIN GATE
════════════════════════════════════════════ */
function pgKey(k) {
  if (k === 'del') {
    currentPin = currentPin.slice(0, -1);
  } else {
    if (currentPin.length >= 4) return;
    currentPin += k;
  }
  updatePinDots('pg');
  if (currentPin.length === 4) checkPinGate();
}

function updatePinDots(prefix) {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(prefix + '-dot-' + i);
    if (dot) dot.classList.toggle('filled', i < currentPin.length);
  }
}

function checkPinGate() {
  const correctPin = pinTarget === 'admin' ? ADMIN_PIN : SITE_PIN;
  if (currentPin === correctPin) {
    closeModal('pin-gate');
    currentPin = '';
    if (pinTarget === 'signup') {
      openModal('signup');
    } else if (pinTarget === 'admin') {
      adminUnlocked = true;
      showAdminTools();
      toast('Admin tools unlocked.', 'success');
    }
  } else {
    const errEl = document.getElementById('pin-gate-error');
    if (errEl) errEl.classList.add('show');
    setTimeout(() => {
      currentPin = '';
      updatePinDots('pg');
      if (errEl) errEl.classList.remove('show');
    }, 900);
  }
}

function openAdminGate() {
  if (adminUnlocked) { showAdminTools(); return; }
  pinTarget  = 'admin';
  currentPin = '';
  document.getElementById('pin-gate-title').textContent = 'Admin Access';
  document.getElementById('pin-gate-sub').textContent   = 'Enter the admin PIN to continue.';
  document.getElementById('pin-gate-error').classList.remove('show');
  updatePinDots('pg');
  openModal('pin-gate');
}

function showAdminTools() {
  const af = document.getElementById('announce-form');
  if (af) af.style.display = 'flex';
}

/* ════════════════════════════════════════════
   ANNOUNCEMENTS
════════════════════════════════════════════ */
async function loadLatestAnnouncement() {
  const { data } = await sb.from('announcements').select('*').eq('dismissed', false).order('created_at', { ascending: false }).limit(1);
  renderAnnouncement(data?.[0] ?? null);
}

function renderAnnouncement(row) {
  const el = document.getElementById('announcement-body');
  if (!el) return;
  if (!row) { el.innerHTML = '<p class="announcement-empty">No announcements right now.</p>'; return; }
  const time = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div style="padding:16px"><div class="announcement-time">${time}</div><div class="announcement-msg">${escHtml(row.message)}</div></div>`;
}

function subscribeAnnouncements() {
  if (announceChannel) sb.removeChannel(announceChannel);
  announceChannel = sb.channel('announcements-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => loadLatestAnnouncement())
    .subscribe();
}

async function sendAnnouncement() {
  const ta  = document.getElementById('announce-input');
  const msg = ta?.value.trim();
  if (!msg) { toast('Write a message first.', 'error'); return; }
  const { error } = await sb.from('announcements').insert({ message: msg, dismissed: false });
  if (error) { toast('Could not send.', 'error'); return; }
  ta.value = '';
  toast('Announcement sent.', 'success');
}

async function dismissAnnouncement() {
  const { data } = await sb.from('announcements').select('id').eq('dismissed', false).order('created_at', { ascending: false }).limit(1);
  if (!data?.length) { toast('Nothing to dismiss.', ''); return; }
  const { error } = await sb.from('announcements').update({ dismissed: true }).eq('id', data[0].id);
  if (error) { toast('Could not dismiss.', 'error'); return; }
  toast('Announcement dismissed.', 'success');
}

/* ════════════════════════════════════════════
   DASHBOARD STATS
════════════════════════════════════════════ */
async function loadDashboardStats() {
  if (!currentUser) return;
  const uid = currentUser.id;
  try {
    const [{ count: postCount }, { count: friendCount }] = await Promise.all([
      sb.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', uid),
      sb.from('friendships').select('*', { count: 'exact', head: true })
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .eq('status', 'accepted'),
    ]);
    const postsEl   = document.getElementById('stat-posts');
    const friendsEl = document.getElementById('stat-friends');
    if (postsEl)   postsEl.textContent   = postCount   ?? 0;
    if (friendsEl) friendsEl.textContent = friendCount ?? 0;
  } catch (_) {}
}

/* ════════════════════════════════════════════
   HOME WELCOME
════════════════════════════════════════════ */
function initHomeGreeting(username) {
  const greetEl = document.getElementById('home-greeting');
  const dateEl  = document.getElementById('home-date');
  if (greetEl && username) {
    const h = new Date().getHours();
    const tod = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    greetEl.textContent = `${tod}, @${username}`;
  }
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
}

/* ════════════════════════════════════════════
   CLOAK AI CHATBOT
════════════════════════════════════════════ */
const CLOAK_API   = 'https://api.usecloak.org/v1/chat';
const CLOAK_MODEL = 'pneuma';

let chatHistory = []; // { role: 'user'|'assistant', message: '...' }
let chatTyping  = false;

function chatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
}

function toggleCloak() {
  const panel = document.getElementById('cloak-panel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  document.body.classList.toggle('cloak-open', isOpen);
  if (isOpen) {
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 80);
  }
}

async function sendChatMessage() {
  const input   = document.getElementById('chat-input');
  const content = input?.value.trim();
  if (!content || chatTyping) return;
  input.value = '';

  chatHistory.push({ role: 'user', message: content });
  renderChatMessages();

  chatTyping = true;
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-bubble bot typing';
    typingEl.textContent = '…';
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  try {
    const messages = [
      ...chatHistory.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.message,
      })),
      { role: 'user', content },
    ];
    const res = await fetch(CLOAK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CLOAK_MODEL, messages }),
    });
    const json = await res.json();
    if (json.error) throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
    const reply = json.response || 'No response received.';
    chatHistory.push({ role: 'assistant', message: reply });
  } catch (e) {
    chatHistory.push({ role: 'assistant', message: 'Could not reach Cloak AI. Check your connection or try again later.' });
  }

  chatTyping = false;
  renderChatMessages();
}

function renderChatMessages() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  el.innerHTML = chatHistory.map((m, i) => {
    const cls = m.role === 'user' ? 'user' : 'bot';
    return `<div class="chat-bubble ${cls}" style="animation-delay:${i * 20}ms">${escHtml(m.message)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

/* ════════════════════════════════════════════
   PERIOD CLOCK
════════════════════════════════════════════ */
function toMin(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function fmtCountdown(s) {
  const m = Math.floor(Math.abs(s)/60), sec = Math.abs(s)%60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function toggleClock() {
  clockCollapsed = !clockCollapsed;
  const body = document.getElementById('clock-body');
  const btn  = document.getElementById('clock-toggle-btn');
  if (body) body.style.display = clockCollapsed ? 'none' : '';
  if (btn)  btn.textContent    = clockCollapsed ? '▾' : '▴';
}

function startClock() { renderClock(); setInterval(renderClock, 1000); }

function renderClock() {
  const now     = new Date();
  const dayMin  = now.getHours()*60 + now.getMinutes();
  const sec     = now.getSeconds();
  const totSec  = dayMin*60 + sec;
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];

  const pdName  = document.getElementById('pd-name');
  const pdTime  = document.getElementById('pd-time');
  const pdLabel = document.getElementById('pd-label');
  const pdBar   = document.getElementById('pd-bar');
  const pdList  = document.getElementById('periods-list');
  if (!pdName) return;

  const schedule = getTodaySchedule();
  if (!schedule) {
    pdName.textContent = dayName; pdTime.textContent = '--:--';
    pdLabel.textContent = 'No school today'; pdBar.style.width = '0%';
    if (pdList) pdList.innerHTML = `<div style="padding:10px 8px;font-size:11px;color:var(--text-faint)">No schedule on weekends.</div>`;
    return;
  }

  let current = null, next = null;
  for (let i = 0; i < schedule.length; i++) {
    const p = schedule[i], sMin = toMin(p.start), eMin = toMin(p.end);
    if (dayMin >= sMin && dayMin < eMin) { current = {...p, idx:i}; break; }
    if (dayMin < sMin && !next)          { next    = {...p, idx:i}; }
  }

  if (current) {
    const eSec = toMin(current.end)*60, remSec = eSec - totSec;
    const durSec = eSec - toMin(current.start)*60;
    const pct = Math.min(100, Math.max(0, ((durSec - remSec)/durSec)*100));
    pdName.textContent = current.name; pdTime.textContent = fmtCountdown(Math.max(0,remSec));
    pdLabel.textContent = 'remaining'; pdBar.style.width = pct.toFixed(1)+'%'; pdBar.style.background = 'var(--accent)';
  } else if (next) {
    const remSec = toMin(next.start)*60 - totSec;
    pdName.textContent = 'Up next: '+next.name; pdTime.textContent = fmtCountdown(Math.max(0,remSec));
    pdLabel.textContent = 'until start'; pdBar.style.width = '0%'; pdBar.style.background = 'var(--accent-hover)';
  } else {
    pdName.textContent = dayName; pdTime.textContent = 'Done';
    pdLabel.textContent = 'School day is over'; pdBar.style.width = '100%'; pdBar.style.background = 'var(--accent-hover)';
  }

  const scheduleKey = now.getDay()+'-'+(schedule===SCHEDULE_WEDNESDAY?'wed':'std');
  if (pdList) {
    if (pdList.dataset.rendered !== scheduleKey) {
      const isWed = now.getDay()===3;
      pdList.innerHTML = `<div class="schedule-day-label">${isWed?'Wednesday — PLC Late Start':'Standard Day'}</div>`
        + schedule.map(p => `<div class="period-row${current&&current.name===p.name?' current':''}"><span class="pr-name">${p.name}</span><span class="pr-time">${p.start}–${p.end}</span></div>`).join('');
      pdList.dataset.rendered = scheduleKey;
    } else {
      pdList.querySelectorAll('.period-row').forEach((row,i) => {
        row.classList.toggle('current', !!(current && schedule[i]?.name===current.name));
      });
    }
  }
}

/* ════════════════════════════════════════════
   MODALS
════════════════════════════════════════════ */
function openModal(name) {
  const el = document.getElementById('modal-'+name);
  if (el) el.classList.add('open');
}
function closeModal(name) {
  const el = document.getElementById('modal-'+name);
  if (el) el.classList.remove('open');
  if (name === 'pin-gate') { currentPin = ''; updatePinDots('pg'); }
}
function switchModal(from, to) { closeModal(from); openModal(to); }

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        const name = overlay.id.replace('modal-','');
        if (name !== 'pin-gate') closeModal(name);
      }
    });
  });
});

/* ════════════════════════════════════════════
   TOAST + HELPERS
════════════════════════════════════════════ */
let toastTimer;
function toast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = 'show' + (type ? ' '+type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.add('show'); } }
function hideErr(el)      { if (el) el.classList.remove('show'); }
function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}