/* ════════════════════════════════════════════
   CougSpot — Core App
   ════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://dqcyecscdelfikbimnpw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3llY3NjZGVsZmlrYmltbnB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzIwOTUsImV4cCI6MjA5Mzc0ODA5NX0.PIl0Syj--UQNjtMKNjAWmisYwOA50Aw5ICNv6J-UNDQ';
const SITE_PIN      = '2345';   // required to create an account
const ADMIN_PIN     = '7892';   // unlocks announcement tools

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

/* ── Content Moderation ── */
const SEXUAL_PATTERNS = [
  /\b(porn|nsfw|nude|naked|sex(?:ting|ual)?|onlyfans|horny|dick|cock|pussy|ass(?:hole)?|boob|tit|cum|masturbat|jerk\s*off|fuck(?:ing)?|slut|whore)\b/i
];
const THREAT_PATTERNS = [
  /\b(kill\s*(you|him|her|them|myself|yourself)|shoot\s*(up|the\s*school)|bomb|i'?ll\s*(hurt|kill|stab|shoot)|going\s*to\s*(hurt|kill|shoot|stab)|want\s*(you|him|her)\s*dead|suicide|end\s*my\s*life|shoot\s*everyone|school\s*shooting)\b/i
];
const SPAM_PATTERNS = [
  /(.)\1{6,}/,                          // aaaaaaa
  /(https?:\/\/[^\s]+){3,}/i,           // 3+ links
  /(\b\w+\b)(\s+\1){4,}/i,             // word repeated 5+ times
];

function classifyContent(text) {
  const flags = [];
  if (SEXUAL_PATTERNS.some(r => r.test(text))) flags.push('sexual');
  if (THREAT_PATTERNS.some(r  => r.test(text))) flags.push('threat');
  return flags;
}

function isSpam(text) {
  return SPAM_PATTERNS.some(r => r.test(text));
}

async function flagContent(type, id, userId, username, text, flagTypes) {
  for (const ft of flagTypes) {
    await sb.from('flags').insert({
      content_type: type,
      content_id:   id,
      user_id:      userId,
      username:     username,
      content_text: text.slice(0, 400),
      flag_type:    ft,
      auto_flagged: true,
    });
  }
}

/* ── Rate Limit (client-side, backed by spam_log) ── */
const postTimestamps = [];
function checkRateLimit() {
  const now = Date.now();
  const recent = postTimestamps.filter(t => now - t < 60000);
  postTimestamps.length = 0;
  postTimestamps.push(...recent);
  if (recent.length >= 5) return false; // max 5 posts/min
  postTimestamps.push(now);
  return true;
}

/* ── State ── */
// Mirror to window so social.js (separate IIFE) can read it via window.currentUser
let currentUser     = null;
Object.defineProperty(window, 'currentUser', {
  get() { return currentUser; },
  set(v) { currentUser = v; },
  configurable: true,
});
let currentPostTag  = 'general';
let postAnonMode    = false;
let commentAnonMode = {};  // keyed by post_id
let currentPin      = '';
let pinTarget       = null; // 'signup' | 'admin'
let adminUnlocked   = false;
let announceChannel = null;
let postsChannel    = null;
let commentsChannel = null;
let activeFilter    = 'all';
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
  ['nav-avatar','compose-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = init;
  });
  loadPosts();
  loadLatestAnnouncement();
  subscribeRealtime();
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

// Step 1: landing "Create Account" → show PIN gate first
function startSignup() {
  pinTarget = 'signup';
  currentPin = '';
  document.getElementById('pin-gate-title').textContent  = 'Enter site PIN';
  document.getElementById('pin-gate-sub').textContent    = 'This site is invite-only. Enter the PIN to continue.';
  document.getElementById('pin-gate-error').classList.remove('show');
  updatePinDots('pg');
  openModal('pin-gate');
}

// Step 2: after correct PIN → show signup form
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
  if (postsChannel)    sb.removeChannel(postsChannel);
  if (commentsChannel) sb.removeChannel(commentsChannel);
  await sb.auth.signOut();
  toast('Signed out.', '');
}

/* ════════════════════════════════════════════
   PIN GATE (site-wide signup + admin)
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
  pinTarget = 'admin';
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
   POSTS
════════════════════════════════════════════ */
async function loadPosts(filter) {
  if (filter !== undefined) activeFilter = filter;
  // Update filter button states
  document.querySelectorAll('.feed-filter-btn').forEach(b => {
    const isActive = b.dataset.filter === activeFilter;
    b.style.background  = isActive ? 'var(--accent-soft)' : '';
    b.style.borderColor = isActive ? 'var(--accent)'      : '';
    b.style.color       = isActive ? 'var(--accent)'      : '';
  });

  const container = document.getElementById('posts-container');
  if (!container) return;
  container.innerHTML = `<div class="empty-state"><div class="spinner" style="color:var(--accent);margin:0 auto 10px;width:22px;height:22px"></div><p>Loading...</p></div>`;

  let query = sb.from('posts').select('*, comment_count:comments(count)').eq('hidden', false).order('created_at', { ascending: false }).limit(40);
  if (activeFilter !== 'all') query = query.eq('tag', activeFilter);

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    container.innerHTML = `<div class="empty-state"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>Nothing here yet.</p></div>`;
    return;
  }
  container.innerHTML = data.map(p => renderPostCard(p)).join('');
  if (window.SocialLayer?.hydratePosts) window.SocialLayer.hydratePosts();
}

function renderPostCard(p) {
  const isAnon    = p.is_anon || p.source === 'social';
  const dispName  = isAnon && p.source !== 'social' ? 'Anonymous' : escHtml(p.username || 'User');
  const initials  = isAnon && p.source !== 'social' ? '??' : (p.username || 'U').slice(0,2).toUpperCase();
  const time      = timeAgo(p.created_at);
  const isSocial  = p.source === 'social';
  const commentCount = p.comment_count?.[0]?.count ?? 0;
  const ownerId = p.user_id || '';
  const profileClick = (!isAnon && ownerId) ? `onclick="SocialLayer && SocialLayer.openProfileView('${ownerId}')" style="cursor:pointer"` : '';
  return `<div class="post-card" id="post-${p.id}" data-post-id="${p.id}" data-user-id="${ownerId}">
    <div class="post-header">
      <div class="avatar" ${profileClick} style="${isSocial ? 'background:var(--accent);' : ''}${(!isAnon && ownerId) ? 'cursor:pointer;' : ''}">${initials}</div>
      <div class="post-meta">
        <div class="post-name" ${profileClick}>${dispName}${isSocial ? ' <span style="font-size:10px;color:var(--accent);font-weight:500">· Social</span>' : ''}</div>
        <div class="post-time">${time}</div>
      </div>
      <span class="post-tag ${p.tag || 'general'}">${p.tag || 'general'}</span>
    </div>
    <div class="post-body">${escHtml(p.content)}</div>
    <div class="post-reactions"></div>
    <div class="post-actions">
      <button class="post-act-btn" onclick="toggleComments('${p.id}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span id="cc-${p.id}">${commentCount}</span>
      </button>
      <div class="post-owner-actions"></div>
    </div>
    <div class="comments-section" id="comments-${p.id}" style="display:none"></div>
  </div>`;
}

function setPostTag(tag, el) {
  currentPostTag = tag;
  document.querySelectorAll('.compose-tags .tag-btn').forEach(b => {
    b.style.background = ''; b.style.borderColor = ''; b.style.color = '';
  });
  if (el) { el.style.background = 'var(--accent-soft)'; el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)'; }
}

function toggleAnonPost() {
  postAnonMode = !postAnonMode;
  const btn = document.getElementById('anon-post-btn');
  if (btn) {
    btn.style.background  = postAnonMode ? 'var(--accent-soft)' : '';
    btn.style.borderColor = postAnonMode ? 'var(--accent)'      : '';
    btn.style.color       = postAnonMode ? 'var(--accent)'      : '';
    btn.title = postAnonMode ? 'Posting anonymously — click to switch back' : 'Post anonymously';
  }
}

async function submitPost() {
  const input   = document.getElementById('compose-input');
  const content = input?.value.trim();
  if (!content)     { toast('Write something first.', 'error'); return; }
  if (!currentUser) { toast('Not signed in.', 'error'); return; }

  // Rate limit
  if (!checkRateLimit()) { toast('Slow down — too many posts.', 'error'); return; }

  // Spam check
  if (isSpam(content)) {
    await sb.from('spam_log').insert({ user_id: currentUser.id, action: 'post_spam_blocked' });
    toast('That looks like spam.', 'error');
    return;
  }

  // Content classification
  const flags = classifyContent(content);
  const hasHardBlock = flags.includes('sexual');
  if (hasHardBlock) { toast('That content is not allowed.', 'error'); return; }

  const username = postAnonMode ? 'Anonymous' : (currentUser.user_metadata?.username || 'User');
  const { data: inserted, error } = await sb.from('posts').insert({
    content,
    tag:        currentPostTag,
    user_id:    currentUser.id,
    username,
    is_anon:    postAnonMode,
    source:     'user',
    hidden:     false,
    spam_score: 0,
  }).select().single();

  if (error) { toast('Could not post. Try again.', 'error'); return; }

  // Silently flag threats
  if (flags.includes('threat') && inserted) {
    await flagContent('post', inserted.id, currentUser.id, username, content, ['threat']);
  }

  input.value = '';
  toast('Posted.', 'success');
  loadPosts();
  if (window.SocialLayer?.hydratePosts) setTimeout(() => window.SocialLayer.hydratePosts(), 300);
}

/* ════════════════════════════════════════════
   COMMENTS + REPLIES
════════════════════════════════════════════ */
async function toggleComments(postId) {
  const section = document.getElementById('comments-' + postId);
  if (!section) return;
  if (section.style.display === 'none') {
    section.style.display = 'block';
    await loadComments(postId);
  } else {
    section.style.display = 'none';
  }
}

async function loadComments(postId) {
  const section = document.getElementById('comments-' + postId);
  if (!section) return;
  section.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--text-faint)"><span class="spinner" style="color:var(--accent);width:14px;height:14px;margin-right:6px"></span>Loading...</div>`;

  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .is('parent_id', null)
    .eq('hidden', false)
    .order('created_at', { ascending: true });

  if (error) { section.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--text-faint)">Could not load comments.</div>`; return; }

  // Fetch all replies for this post in one query
  const { data: replies } = await sb
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .not('parent_id', 'is', null)
    .eq('hidden', false)
    .order('created_at', { ascending: true });

  const replyMap = {};
  (replies || []).forEach(r => {
    if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
    replyMap[r.parent_id].push(r);
  });

  const commentHTML = (data || []).map(c => renderComment(c, replyMap[c.id] || [], postId)).join('');
  section.innerHTML = `
    <div class="comments-list">${commentHTML || '<div class="comment-empty">No comments yet.</div>'}</div>
    ${renderCommentBox(postId, null)}`;
}

function renderComment(c, replies, postId) {
  const isAnon   = c.is_anon;
  const dispName = isAnon ? 'Anonymous' : escHtml(c.username || 'User');
  const initials = isAnon ? '??' : (c.username || 'U').slice(0,2).toUpperCase();
  const repliesHTML = replies.map(r => renderReply(r)).join('');
  return `<div class="comment" id="comment-${c.id}">
    <div class="comment-header">
      <div class="avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0">${initials}</div>
      <div class="post-meta">
        <span class="post-name" style="font-size:13px">${dispName}</span>
        <span class="post-time" style="font-size:11px">${timeAgo(c.created_at)}</span>
      </div>
    </div>
    <div class="comment-body">${escHtml(c.content)}</div>
    <div class="comment-actions">
      <button class="post-act-btn" onclick="showReplyBox('${postId}','${c.id}')">Reply</button>
    </div>
    ${repliesHTML ? `<div class="replies">${repliesHTML}</div>` : ''}
    <div id="reply-box-${c.id}"></div>
  </div>`;
}

function renderReply(r) {
  const isAnon   = r.is_anon;
  const dispName = isAnon ? 'Anonymous' : escHtml(r.username || 'User');
  const initials = isAnon ? '??' : (r.username || 'U').slice(0,2).toUpperCase();
  return `<div class="reply" id="comment-${r.id}">
    <div class="comment-header">
      <div class="avatar" style="width:22px;height:22px;font-size:9px;flex-shrink:0">${initials}</div>
      <div class="post-meta">
        <span class="post-name" style="font-size:12px">${dispName}</span>
        <span class="post-time" style="font-size:11px">${timeAgo(r.created_at)}</span>
      </div>
    </div>
    <div class="comment-body" style="font-size:13px">${escHtml(r.content)}</div>
  </div>`;
}

function renderCommentBox(postId, parentId) {
  const anonId  = `anon-comment-${postId}-${parentId || 'root'}`;
  const inputId = `comment-input-${postId}-${parentId || 'root'}`;
  return `<div class="comment-box">
    <textarea class="comment-textarea" id="${inputId}" placeholder="${parentId ? 'Write a reply...' : 'Write a comment...'}" rows="2"></textarea>
    <div class="comment-box-actions">
      <button class="tag-btn anon-toggle" id="${anonId}" onclick="toggleCommentAnon('${anonId}')" title="Comment anonymously">
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="18" y1="11" x2="18" y2="17"/><line x1="21" y1="14" x2="15" y2="14"/></svg>
        Anon
      </button>
      <button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="submitComment('${postId}','${parentId || ''}','${anonId}','${inputId}')">
        ${parentId ? 'Reply' : 'Comment'}
      </button>
    </div>
  </div>`;
}

function toggleCommentAnon(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const isOn = btn.dataset.anon === 'true';
  btn.dataset.anon    = isOn ? 'false' : 'true';
  btn.style.background  = isOn ? '' : 'var(--accent-soft)';
  btn.style.borderColor = isOn ? '' : 'var(--accent)';
  btn.style.color       = isOn ? '' : 'var(--accent)';
}

function showReplyBox(postId, parentId) {
  const container = document.getElementById('reply-box-' + parentId);
  if (!container) return;
  if (container.innerHTML) { container.innerHTML = ''; return; }
  container.innerHTML = renderCommentBox(postId, parentId);
}

async function submitComment(postId, parentId, anonBtnId, inputId) {
  const input   = document.getElementById(inputId);
  const content = input?.value.trim();
  if (!content)     { toast('Write something first.', 'error'); return; }
  if (!currentUser) { toast('Not signed in.', 'error'); return; }

  const anonBtn = document.getElementById(anonBtnId);
  const isAnon  = anonBtn?.dataset.anon === 'true';

  // Spam/content checks
  if (isSpam(content)) { toast('That looks like spam.', 'error'); return; }
  const flags = classifyContent(content);
  if (flags.includes('sexual')) { toast('That content is not allowed.', 'error'); return; }

  const username = isAnon ? 'Anonymous' : (currentUser.user_metadata?.username || 'User');
  const { data: inserted, error } = await sb.from('comments').insert({
    post_id:   postId,
    parent_id: parentId || null,
    user_id:   currentUser.id,
    username,
    content,
    is_anon:   isAnon,
    hidden:    false,
  }).select().single();

  if (error) { toast('Could not comment. Try again.', 'error'); return; }

  // Silent flag threats
  if (flags.includes('threat') && inserted) {
    await flagContent('comment', inserted.id, currentUser.id, username, content, ['threat']);
  }

  // Refresh comment section
  await loadComments(postId);
  // Update comment count
  const { count } = await sb.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', postId).is('parent_id', null);
  const ccEl = document.getElementById('cc-' + postId);
  if (ccEl) ccEl.textContent = count ?? '';
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
  const ta = document.getElementById('announce-input');
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
   REALTIME SUBSCRIPTIONS
════════════════════════════════════════════ */
function subscribeRealtime() {
  if (postsChannel) sb.removeChannel(postsChannel);
  postsChannel = sb.channel('posts-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
      if (!payload.new.hidden) prependPost(payload.new);
    })
    .subscribe();
}

function prependPost(p) {
  const container = document.getElementById('posts-container');
  if (!container) return;
  // Remove empty state if present
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();
  // Don't duplicate
  if (document.getElementById('post-' + p.id)) return;
  // Filter check
  if (activeFilter !== 'all' && p.tag !== activeFilter) return;
  const div = document.createElement('div');
  div.innerHTML = renderPostCard(p);
  container.prepend(div.firstElementChild);
  if (window.SocialLayer?.hydratePosts) window.SocialLayer.hydratePosts();
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
        // Don't allow closing pin-gate by clicking outside
        if (name !== 'pin-gate') closeModal(name);
      }
    });
  });
});

/* ════════════════════════════════════════════
   NAV
════════════════════════════════════════════ */
function setNav(el) {
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
}

/* ════════════════════════════════════════════
   TOAST
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

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
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
