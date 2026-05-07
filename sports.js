/* ════════════════════════════════════════════
   CougSpot — Sports Page
   Pulls live schedules via Supabase Edge Function
   which proxies MaxPreps data for Norco Cougars
   ════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://dqcyecscdelfikbimnpw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3llY3NjZGVsZmlrYmltbnB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzIwOTUsImV4cCI6MjA5Mzc0ODA5NX0.PIl0Syj--UQNjtMKNjAWmisYwOA50Aw5ICNv6J-UNDQ';

// ─────────────────────────────────────────────────────────
// IMPORTANT: The sports-proxy Edge Function was deployed to
// project kdawsqrrmwirilyhcolk (your connected Supabase account).
// If your CougSpot app uses a DIFFERENT Supabase project,
// re-deploy the Edge Function there and update this URL.
// ─────────────────────────────────────────────────────────
const PROXY_URL = 'https://dqcyecscdelfikbimnpw.supabase.co/functions/v1/sports-proxy';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ──────────────────────────────────────────
   SPORT CATALOGUE
   name, slug (must match Edge Function), icon, season
────────────────────────────────────────── */
const SPORTS_CATALOG = [
  { id: 'football',      name: 'Football',       icon: '🏈', season: 'Fall',   slug: 'football' },
  { id: 'volleyball',    name: 'Volleyball',      icon: '🏐', season: 'Fall',   slug: 'volleyball' },
  { id: 'cross-country', name: 'Cross Country',   icon: '🏃', season: 'Fall',   slug: 'cross-country' },
  { id: 'basketball',    name: 'Basketball',      icon: '🏀', season: 'Winter', slug: 'basketball' },
  { id: 'wrestling',     name: 'Wrestling',       icon: '🤼', season: 'Winter', slug: 'wrestling' },
  { id: 'swimming',      name: 'Swimming',        icon: '🏊', season: 'Winter', slug: 'swimming' },
  { id: 'baseball',      name: 'Baseball',        icon: '⚾', season: 'Spring', slug: 'baseball' },
  { id: 'softball',      name: 'Softball',        icon: '🥎', season: 'Spring', slug: 'softball' },
  { id: 'tennis',        name: 'Tennis',          icon: '🎾', season: 'Spring', slug: 'tennis' },
  { id: 'lacrosse',      name: 'Lacrosse',        icon: '🥍', season: 'Spring', slug: 'lacrosse' },
  { id: 'water-polo',    name: 'Water Polo',      icon: '🤽', season: 'Fall',   slug: 'water-polo' },
];

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
let activeFilter  = 'all';
let loadedData    = {};   // { slug: { games, fetched_at, error } }
let loadingSet    = new Set();
const MAXPREPS_BASE = 'https://www.maxpreps.com/ca/norco/norco-cougars';

/* ──────────────────────────────────────────
   AUTH GUARD
────────────────────────────────────────── */
window.addEventListener('load', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  const username = session.user.user_metadata?.username || '?';
  const el = document.getElementById('nav-avatar-sports');
  if (el) el.textContent = username.slice(0, 2).toUpperCase();

  renderSkeletons();
  loadAllSports();
});

/* ──────────────────────────────────────────
   FETCH — one sport at a time with caching
────────────────────────────────────────── */
async function fetchSport(slug) {
  if (loadingSet.has(slug)) return;
  loadingSet.add(slug);

  // Check sessionStorage cache (1-hour TTL)
  const cacheKey = `cougspot_sport_${slug}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const age = Date.now() - new Date(parsed.fetched_at).getTime();
      if (age < 3600_000) {
        loadedData[slug] = parsed;
        renderCard(slug);
        loadingSet.delete(slug);
        return;
      }
    }
  } catch (_) {}

  try {
    const res = await fetch(`${PROXY_URL}?sport=${encodeURIComponent(slug)}`);
    const json = await res.json();

    if (!res.ok || json.error) {
      loadedData[slug] = { games: [], error: json.error || `HTTP ${res.status}`, fetched_at: new Date().toISOString() };
    } else {
      loadedData[slug] = json;
      try { sessionStorage.setItem(cacheKey, JSON.stringify(json)); } catch (_) {}
    }
  } catch (e) {
    loadedData[slug] = { games: [], error: String(e), fetched_at: new Date().toISOString() };
  }

  renderCard(slug);
  loadingSet.delete(slug);
}

async function loadAllSports() {
  // Stagger requests to avoid hammering
  const visible = getVisibleSports();
  for (let i = 0; i < visible.length; i++) {
    setTimeout(() => fetchSport(visible[i].slug), i * 180);
  }
}

function getVisibleSports() {
  if (activeFilter === 'all') return SPORTS_CATALOG;
  return SPORTS_CATALOG.filter(s => s.season.toLowerCase() === activeFilter);
}

/* ──────────────────────────────────────────
   RENDER — grid skeletons then live cards
────────────────────────────────────────── */
function renderSkeletons() {
  const grid = document.getElementById('sports-grid');
  if (!grid) return;
  const visible = getVisibleSports();
  grid.innerHTML = visible.map(s => `
    <div class="sport-card" id="card-${s.id}" style="animation:fadeUp 0.4s ease both">
      <div class="sport-card-head">
        <div class="sport-icon">${s.icon}</div>
        <div>
          <div class="sport-name">${escHtml(s.name)}</div>
          <div class="sport-season">${s.season} Season</div>
        </div>
      </div>
      <div class="sport-games" id="games-${s.id}">
        ${skeletonRows(3)}
      </div>
      <div class="sport-card-footer" id="footer-${s.id}">
        <span style="color:var(--faint)">Loading schedule...</span>
      </div>
    </div>`).join('');
}

function skeletonRows(n) {
  return Array.from({ length: n }, () => `
    <div class="game-row" style="opacity:0.35">
      <span class="skeleton-line" style="width:${40+Math.random()*30|0}%;height:12px;background:var(--border);border-radius:4px;display:inline-block"></span>
      <span class="skeleton-line" style="width:20%;height:12px;background:var(--border);border-radius:4px;display:inline-block"></span>
      <span class="skeleton-line" style="width:10%;height:12px;background:var(--border);border-radius:4px;display:inline-block"></span>
    </div>`).join('');
}

function renderCard(slug) {
  const sport = SPORTS_CATALOG.find(s => s.slug === slug);
  if (!sport) return;

  const gamesEl  = document.getElementById('games-' + sport.id);
  const footerEl = document.getElementById('footer-' + sport.id);
  if (!gamesEl) return;

  const data = loadedData[slug];
  if (!data) return;

  if (data.error || !data.games || data.games.length === 0) {
    gamesEl.innerHTML = `
      <div style="padding:8px 0;font-size:12px;color:var(--faint);font-weight:300">
        ${data.error ? 'Schedule unavailable right now.' : 'No games found for this season.'}
        <a href="${MAXPREPS_BASE}/${slug}/schedule/" target="_blank"
           style="color:var(--violet);text-decoration:none;margin-left:6px">
          View on MaxPreps ↗
        </a>
      </div>`;
    if (footerEl) footerEl.innerHTML = '';
    return;
  }

  const games = data.games;

  // Separate past and upcoming
  const past     = games.filter(g => g.result);
  const upcoming = games.filter(g => !g.result);

  // Show last 2 completed + next 3 upcoming (or fill with past if no upcoming)
  const toShow = [...upcoming.slice(0, 3), ...past.slice(-2)].slice(0, 5);

  gamesEl.innerHTML = toShow.map(g => {
    const locBadge =
      g.location === 'Away'    ? `<span class="game-location" style="color:#93c5fd;background:rgba(46,111,255,0.1)">Away</span>` :
      g.location === 'Neutral' ? `<span class="game-location">Neutral</span>` :
                                  `<span class="game-location">Home</span>`;

    let resultBadge = '';
    if (g.result) {
      const isWin = g.win;
      const color = isWin ? '#86efac' : '#fca5a5';
      const bg    = isWin ? 'rgba(22,101,52,0.15)' : 'rgba(127,29,29,0.2)';
      resultBadge = `<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:${bg};color:${color};font-weight:500">${escHtml(g.result.replace('(forfeit)', '(FF)'))}</span>`;
    } else if (g.time) {
      resultBadge = `<span style="font-size:11px;color:var(--electric)">${escHtml(g.time)}</span>`;
    }

    return `<div class="game-row">
      <div style="display:flex;flex-direction:column;gap:1px;flex:1;min-width:0">
        <span class="game-opponent" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(g.opponent)}</span>
        <span style="font-size:10px;color:var(--faint)">${escHtml(g.type)}</span>
      </div>
      <span class="game-date">${escHtml(g.date)}</span>
      ${resultBadge}
      ${locBadge}
    </div>`;
  }).join('');

  if (footerEl) {
    const remaining = upcoming.length > 3 ? upcoming.length - 3 : 0;
    footerEl.innerHTML = `
      <a href="${MAXPREPS_BASE}/${slug}/schedule/" target="_blank"
         style="color:var(--violet);text-decoration:none;font-size:11px;font-weight:400">
        ${remaining > 0 ? `+${remaining} more · ` : ''}Full schedule on MaxPreps ↗
      </a>`;
  }
}

/* ──────────────────────────────────────────
   FILTER
────────────────────────────────────────── */
function filterSports(season) {
  activeFilter = season;

  // Update button states
  document.querySelectorAll('[id^="filter-"]').forEach(b => {
    b.style.background  = '';
    b.style.borderColor = '';
    b.style.color       = '';
  });
  const active = document.getElementById('filter-' + season);
  if (active) {
    active.style.background  = 'rgba(26,58,219,0.1)';
    active.style.borderColor = '#1a3adb';
    active.style.color       = '#93aeff';
  }

  renderSkeletons();

  // Load any not-yet-fetched sports for this filter
  const visible = getVisibleSports();
  visible.forEach((s, i) => {
    if (loadedData[s.slug]) {
      // Already have data — render immediately
      renderCard(s.slug);
    } else {
      setTimeout(() => fetchSport(s.slug), i * 180);
    }
  });
}

/* ──────────────────────────────────────────
   SIGN OUT
────────────────────────────────────────── */
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
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

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
