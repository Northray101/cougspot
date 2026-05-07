/* ════════════════════════════════════════════
   CougSpot — Core App Logic
   Auth, Period Clock, Announcements (Realtime)
   ════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://dqcyecscdelfikbimnpw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3llY3NjZGVsZmlrYmltbnB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzIwOTUsImV4cCI6MjA5Mzc0ODA5NX0.PIl0Syj--UQNjtMKNjAWmisYwOA50Aw5ICNv6J-UNDQ';
const ADMIN_PIN     = '7892';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ──────────────────────────────────────────
   NORCO HIGH BELL SCHEDULES
   Source: image.jpg (Standard Day + Wednesday PLC Late Start)
────────────────────────────────────────── */
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

/* Returns the correct schedule array for today, or null on weekends */
function getTodaySchedule() {
  const day = new Date().getDay(); // 0=Sun,1=Mon,...,6=Sat
  if (day === 0 || day === 6) return null;
  return day === 3 ? SCHEDULE_WEDNESDAY : SCHEDULE_STANDARD;
}

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
let currentUser     = null;
let currentPin      = '';
let currentPostTag  = 'general';
let bouncerResolve  = null;
let adminUnlocked   = false;
let announceChannel = null;

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
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
    showScreen('landing');
  }
});

/* ──────────────────────────────────────────
   SCREEN ROUTER
────────────────────────────────────────── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

function enterHome() {
  showScreen('home');
  const initials = getInitials(currentUser?.user_metadata?.username || currentUser?.email || '?');
  const nav  = document.getElementById('nav-avatar');
  const comp = document.getElementById('compose-avatar');
  if (nav)  nav.textContent  = initials;
  if (comp) comp.textContent = initials;
  loadPosts();
  loadLatestAnnouncement();
}

function getInitials(str) {
  return str.slice(0, 2).toUpperCase();
}

/* ──────────────────────────────────────────
   AUTH — Username + Password (no email verify)
────────────────────────────────────────── */
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  const err      = document.getElementById('login-error');

  if (!username || !password) { showErr(err, 'Fill in all fields.'); return; }

  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled  = true;

  // Supabase uses email under the hood; we store username as the local part
  const fakeEmail = username.toLowerCase().replace(/[^a-z0-9]/g, '') + '@cougspot.app';
  const { data, error } = await sb.auth.signInWithPassword({ email: fakeEmail, password });

  btn.disabled = false;
  btn.textContent = 'Sign in';

  if (error) { showErr(err, 'Username or password is incorrect.'); return; }
  hideErr(err);
  closeModal('login');
  currentUser = data.user;
  enterHome();
  toast('Signed in.', 'success');
}

async function doSignup() {
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const btn      = document.getElementById('signup-btn');
  const err      = document.getElementById('signup-error');

  if (!username || !password) { showErr(err, 'Fill in all fields.'); return; }
  if (username.length < 3)    { showErr(err, 'Username must be at least 3 characters.'); return; }
  if (password.length < 8)    { showErr(err, 'Password must be at least 8 characters.'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showErr(err, 'Username can only contain letters, numbers, and underscores.');
    return;
  }

  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled  = true;

  const fakeEmail = username.toLowerCase().replace(/[^a-z0-9]/g, '') + '@cougspot.app';
  const { data, error } = await sb.auth.signUp({
    email:    fakeEmail,
    password: password,
    options:  { data: { username: username }, emailRedirectTo: null }
  });

  btn.disabled = false;
  btn.textContent = 'Create account';

  if (error) { showErr(err, error.message); return; }

  // If email confirmation is disabled in Supabase, user is immediately active
  if (data.session) {
    hideErr(err);
    closeModal('signup');
    currentUser = data.user;
    enterHome();
    toast('Account created. Welcome to CougSpot.', 'success');
  } else {
    // Supabase project still has email confirm on — advise turning it off
    hideErr(err);
    closeModal('signup');
    toast('Account created. Sign in to continue.', 'success');
  }
}

async function signOut() {
  await sb.auth.signOut();
  adminUnlocked = false;
  toast('Signed out.', '');
}

/* ──────────────────────────────────────────
   POSTS
────────────────────────────────────────── */
async function loadPosts() {
  const container = document.getElementById('posts-container');
  if (!container) return;

  const { data, error } = await sb
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error || !data || data.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>No posts yet. Be the first to post something.</p>
      </div>`;
    return;
  }

  container.innerHTML = data.map(p => {
    const initials = getInitials(p.username || 'U');
    const time     = timeAgo(p.created_at);
    return `<div class="post-card">
      <div class="post-header">
        <div class="avatar">${initials}</div>
        <div class="post-meta">
          <div class="post-name">${escHtml(p.username || 'User')}</div>
          <div class="post-time">${time}</div>
        </div>
        <span class="post-tag ${p.tag || 'general'}">${p.tag || 'general'}</span>
      </div>
      <div class="post-body">${escHtml(p.content)}</div>
    </div>`;
  }).join('');
}

function setPostTag(tag) {
  currentPostTag = tag;
  document.querySelectorAll('.compose-tags .tag-btn').forEach(b => {
    b.style.background  = '';
    b.style.borderColor = '';
    b.style.color       = '';
  });
  event.target.style.background  = 'rgba(26,58,219,0.12)';
  event.target.style.borderColor = '#1a3adb';
  event.target.style.color       = '#93aeff';
}

async function submitPost() {
  const input   = document.getElementById('compose-input');
  const content = input.value.trim();
  if (!content)      { toast('Write something first.', 'error'); return; }
  if (!currentUser)  { toast('Not signed in.', 'error'); return; }

  const username = currentUser.user_metadata?.username || 'User';
  const { error } = await sb.from('posts').insert({
    content,
    tag:      currentPostTag,
    user_id:  currentUser.id,
    username: username
  });

  if (error) { toast('Could not post. Try again.', 'error'); return; }
  input.value = '';
  loadPosts();
  toast('Posted.', 'success');
}

/* ──────────────────────────────────────────
   ANNOUNCEMENTS — Realtime
────────────────────────────────────────── */
async function loadLatestAnnouncement() {
  const { data } = await sb
    .from('announcements')
    .select('*')
    .eq('dismissed', false)
    .order('created_at', { ascending: false })
    .limit(1);

  renderAnnouncement(data && data.length > 0 ? data[0] : null);
}

function renderAnnouncement(row) {
  const bodyEl = document.getElementById('announcement-body');
  if (!bodyEl) return;

  if (!row) {
    bodyEl.innerHTML = '<p class="announcement-empty">No announcements right now.</p>';
    return;
  }

  const time = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  bodyEl.innerHTML = `
    <div class="announcement-body" style="padding:16px">
      <div class="announcement-time">${time}</div>
      <div class="announcement-msg">${escHtml(row.message)}</div>
    </div>`;
}

function subscribeAnnouncements() {
  if (announceChannel) sb.removeChannel(announceChannel);

  announceChannel = sb
    .channel('announcements-realtime')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'announcements' },
      () => { loadLatestAnnouncement(); }
    )
    .subscribe();
}

/* Admin: send announcement */
async function sendAnnouncement() {
  const textarea = document.getElementById('announce-input');
  if (!textarea) return;
  const msg = textarea.value.trim();
  if (!msg) { toast('Write a message first.', 'error'); return; }

  const { error } = await sb.from('announcements').insert({ message: msg, dismissed: false });
  if (error) { toast('Could not send. Check permissions.', 'error'); return; }
  textarea.value = '';
  toast('Announcement sent.', 'success');
}

/* Admin: dismiss current announcement */
async function dismissAnnouncement() {
  const { data } = await sb
    .from('announcements')
    .select('id')
    .eq('dismissed', false)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) { toast('Nothing to dismiss.', ''); return; }

  const { error } = await sb.from('announcements').update({ dismissed: true }).eq('id', data[0].id);
  if (error) { toast('Could not dismiss.', 'error'); return; }
  toast('Announcement dismissed.', 'success');
}

/* ──────────────────────────────────────────
   PERIOD CLOCK
────────────────────────────────────────── */
function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtCountdown(seconds) {
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function startClock() {
  renderClock();
  setInterval(renderClock, 1000);
}

function renderClock() {
  const now      = new Date();
  const dayMin   = now.getHours() * 60 + now.getMinutes();
  const sec      = now.getSeconds();
  const totalSec = dayMin * 60 + sec;
  const dayName  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];

  const pdName  = document.getElementById('pd-name');
  const pdTime  = document.getElementById('pd-time');
  const pdLabel = document.getElementById('pd-label');
  const pdBar   = document.getElementById('pd-bar');
  const pdList  = document.getElementById('periods-list');

  if (!pdName) return;

  const schedule = getTodaySchedule();

  if (!schedule) {
    pdName.textContent  = dayName;
    pdTime.textContent  = '--:--';
    pdLabel.textContent = 'No school today';
    pdBar.style.width   = '0%';
    if (pdList) pdList.innerHTML = `<div style="padding:12px 8px;font-size:12px;color:var(--faint)">No schedule on weekends.</div>`;
    return;
  }

  let current    = null;
  let nextPeriod = null;

  for (let i = 0; i < schedule.length; i++) {
    const p    = schedule[i];
    const sMin = toMin(p.start);
    const eMin = toMin(p.end);
    if (dayMin >= sMin && dayMin < eMin) { current = { ...p, idx: i }; break; }
    if (dayMin < sMin && !nextPeriod)    { nextPeriod = { ...p, idx: i }; }
  }

  if (current) {
    const eMin      = toMin(current.end);
    const eSec      = eMin * 60;
    const remSec    = eSec - totalSec;
    const sTotalSec = toMin(current.start) * 60;
    const durSec    = eSec - sTotalSec;
    const pct       = Math.min(100, Math.max(0, ((durSec - remSec) / durSec) * 100));

    pdName.textContent  = current.name;
    pdTime.textContent  = fmtCountdown(Math.max(0, remSec));
    pdLabel.textContent = 'remaining';
    pdBar.style.width   = pct.toFixed(1) + '%';
    pdBar.style.background = '#1a3adb';
  } else if (nextPeriod) {
    const sMin   = toMin(nextPeriod.start);
    const remSec = sMin * 60 - totalSec;
    pdName.textContent  = 'Up next: ' + nextPeriod.name;
    pdTime.textContent  = fmtCountdown(Math.max(0, remSec));
    pdLabel.textContent = 'until start';
    pdBar.style.width   = '0%';
    pdBar.style.background = '#7b5ef8';
  } else {
    pdName.textContent  = dayName;
    pdTime.textContent  = 'Done';
    pdLabel.textContent = 'School day is over';
    pdBar.style.width   = '100%';
    pdBar.style.background = '#7b5ef8';
  }

  // Render list (once per session, update active highlight every tick)
  // Reset cache key when schedule type changes (shouldn't happen mid-day but safety)
  const scheduleKey = now.getDay() + '-' + (schedule === SCHEDULE_WEDNESDAY ? 'wed' : 'std');
  if (pdList) {
    if (pdList.dataset.rendered !== scheduleKey) {
      const isWed = now.getDay() === 3;
      pdList.innerHTML = `
        <div class="schedule-day-label">${isWed ? 'Wednesday — PLC Late Start' : 'Standard Day'}</div>
        ${schedule.map(p => {
          const isCur = current && current.name === p.name;
          return `<div class="period-row${isCur ? ' current' : ''}">
            <span class="pr-name">${p.name}</span>
            <span class="pr-time">${p.start}–${p.end}</span>
          </div>`;
        }).join('')}`;
      pdList.dataset.rendered = scheduleKey;
    } else {
      // .period-row elements map 1:1 with schedule[] — the label div uses a different class
      pdList.querySelectorAll('.period-row').forEach((row, i) => {
        row.classList.toggle('current', !!(current && schedule[i]?.name === current.name));
      });
    }
  }
}

/* ──────────────────────────────────────────
   MODALS
────────────────────────────────────────── */
function openModal(name) {
  const el = document.getElementById('modal-' + name);
  if (el) el.classList.add('open');
}

function closeModal(name) {
  const el = document.getElementById('modal-' + name);
  if (el) el.classList.remove('open');
  if (name === 'bouncer') { currentPin = ''; updatePinDots(); }
}

function switchModal(from, to) {
  closeModal(from);
  openModal(to);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeModal(overlay.id.replace('modal-', ''));
      }
    });
  });
});

/* ──────────────────────────────────────────
   BOUNCER (Admin PIN gate)
────────────────────────────────────────── */
function openBouncer() {
  currentPin = '';
  updatePinDots();
  document.getElementById('bouncer-error').classList.remove('show');
  openModal('bouncer');
  return new Promise(resolve => { bouncerResolve = resolve; });
}

function pinKey(k) {
  if (k === 'del') {
    currentPin = currentPin.slice(0, -1);
  } else {
    if (currentPin.length >= 4) return;
    currentPin += k;
  }
  updatePinDots();
  if (currentPin.length === 4) checkPin();
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pd' + i);
    if (dot) dot.classList.toggle('filled', i < currentPin.length);
  }
}

function checkPin() {
  if (currentPin === ADMIN_PIN) {
    closeModal('bouncer');
    adminUnlocked = true;
    if (bouncerResolve) bouncerResolve(true);
    showAdminTools();
  } else {
    document.getElementById('bouncer-error').classList.add('show');
    setTimeout(() => {
      currentPin = '';
      updatePinDots();
      document.getElementById('bouncer-error').classList.remove('show');
    }, 900);
  }
}

function showAdminTools() {
  const af = document.getElementById('announce-form');
  if (af) af.style.display = 'flex';
}

/* ──────────────────────────────────────────
   NAV
────────────────────────────────────────── */
function setNav(el) {
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
}

/* ──────────────────────────────────────────
   TOAST
────────────────────────────────────────── */
let toastTimer;
function toast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

/* ──────────────────────────────────────────
   HELPERS
────────────────────────────────────────── */
function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.add('show'); } }
function hideErr(el)      { if (el) el.classList.remove('show'); }

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
