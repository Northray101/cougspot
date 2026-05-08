/* ========================================
   CougSpot — Games Library
======================================== */

const SUPABASE_URL  = 'https://dqcyecscdelfikbimnpw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3llY3NjZGVsZmlrYmltbnB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzIwOTUsImV4cCI6MjA5Mzc0ODA5NX0.PIl0Syj--UQNjtMKNjAWmisYwOA50Aw5ICNv6J-UNDQ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let currentFilter = 'all';
let playCounts = {};

const GAMES = [
  { id: '2048',    name: '2048',        category: 'html5',  addedAt: '2026-05-08', src: 'games/2048/index.html',   icon: '🔢', desc: 'Slide tiles, reach 2048.' },
  { id: 'snake',   name: 'Snake',       category: 'html5',  addedAt: '2026-05-08', src: 'games/snake/index.html',  icon: '🐍', desc: 'Eat apples, grow, survive.' },
  { id: 'tetris',  name: 'Tetris',      category: 'html5',  addedAt: '2026-05-08', src: 'games/tetris/index.html', icon: '🧱', desc: 'Stack blocks, clear lines.' },
  { id: 'flappy',  name: 'Flappy Bird', category: 'html5',  addedAt: '2026-05-08', src: 'games/flappy/index.html', icon: '🐦', desc: 'Tap to fly through pipes.' },
  { id: 'wordle',  name: 'Wordle',      category: 'puzzle', addedAt: '2026-05-08', src: 'games/wordle/index.html', icon: '🟩', desc: 'Guess the 5-letter word.' },
  { id: 'sudoku',  name: 'Sudoku',      category: 'puzzle', addedAt: '2026-05-08', src: 'games/sudoku/index.html', icon: '🔣', desc: 'Fill the 9×9 grid.' },
  { id: 'nes-placeholder', name: 'NES — Coming Soon', category: 'retro', addedAt: '2026-05-08', src: null, icon: '🕹️', desc: 'Drop an NES ROM into games/roms/ and add it to GAMES.' },
  { id: 'snes-placeholder', name: 'SNES — Coming Soon', category: 'retro', addedAt: '2026-05-08', src: null, icon: '🎮', desc: 'Drop a SNES ROM into games/roms/ and add it to GAMES.' },
];

window.addEventListener('load', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  currentUser = session.user;

  const av = document.getElementById('nav-avatar-games');
  if (av) {
    const meta = currentUser.user_metadata || {};
    const initial = (meta.username || currentUser.email || '?').charAt(0).toUpperCase();
    av.textContent = initial;
  }

  await loadPlayCounts();
  renderAll();
});

async function loadPlayCounts() {
  const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  try {
    const { data, error } = await sb.from('game_plays').select('game_id').gte('played_at', since);
    if (error) { console.warn('play counts:', error.message); return; }
    playCounts = {};
    (data || []).forEach(r => { playCounts[r.game_id] = (playCounts[r.game_id] || 0) + 1; });
  } catch (e) {
    console.warn('play counts failed', e);
  }
}

function renderAll() {
  renderSection('popular');
  renderSection('new');
  renderGrid(currentFilter);
  toggleSections();
}

function toggleSections() {
  const showSections = currentFilter === 'all';
  document.getElementById('section-popular').style.display = (currentFilter === 'all' || currentFilter === 'popular') ? 'block' : 'none';
  document.getElementById('section-new').style.display     = (currentFilter === 'all' || currentFilter === 'new')     ? 'block' : 'none';
  document.getElementById('grid-section').style.display    = (currentFilter !== 'popular' && currentFilter !== 'new') ? 'block' : 'none';
}

function renderSection(type) {
  let list;
  if (type === 'popular') {
    list = GAMES.filter(g => g.src).slice().sort((a,b) => (playCounts[b.id]||0) - (playCounts[a.id]||0)).slice(0, 4);
  } else {
    list = GAMES.slice().sort((a,b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 4);
  }
  const target = document.getElementById('row-' + type);
  target.innerHTML = list.map((g, i) => gameCard(g, i * 60)).join('');
}

function renderGrid(filter) {
  let list = GAMES;
  if (filter === 'popular') list = GAMES.filter(g => g.src).slice().sort((a,b) => (playCounts[b.id]||0) - (playCounts[a.id]||0));
  else if (filter === 'new')   list = GAMES.slice().sort((a,b) => b.addedAt.localeCompare(a.addedAt));
  else if (filter !== 'all')   list = GAMES.filter(g => g.category === filter);

  const grid = document.getElementById('games-grid');
  grid.innerHTML = list.map((g, i) => gameCard(g, i * 50)).join('');
}

function gameCard(game, delay) {
  const plays = playCounts[game.id] || 0;
  const playLabel = plays === 0 ? 'No plays yet' : (plays === 1 ? '1 play this week' : `${plays} plays this week`);
  const dimmed = !game.src ? ' style-dimmed' : '';
  return `
    <div class="game-card${dimmed}" onclick="openGame('${game.id}')" style="animation: fadeUp 400ms var(--ease) ${delay}ms both">
      <div class="game-thumb">${game.icon}</div>
      <div class="game-info">
        <div class="game-name-row">
          <span class="game-name">${escHtml(game.name)}</span>
          <span class="game-badge game-badge-${game.category}">${game.category}</span>
        </div>
        <div class="game-desc">${escHtml(game.desc)}</div>
        <div class="game-plays">${playLabel}</div>
      </div>
    </div>
  `;
}

async function openGame(id) {
  const game = GAMES.find(g => g.id === id);
  if (!game) return;
  if (!game.src) { toast('Add a ROM to games/roms/ to enable.', 'error'); return; }

  // Record play (fire and forget)
  sb.from('game_plays').insert({ game_id: id, user_id: currentUser.id }).then(({ error }) => {
    if (error) console.warn('record play:', error.message);
    else { playCounts[id] = (playCounts[id] || 0) + 1; }
  });

  document.getElementById('game-modal-title').textContent = game.name;
  const iframe = document.getElementById('game-iframe');
  iframe.src = game.src;
  document.getElementById('game-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeGame() {
  const iframe = document.getElementById('game-iframe');
  iframe.src = 'about:blank';
  document.getElementById('game-modal').classList.remove('open');
  document.body.style.overflow = '';
  // Re-render so latest play counts show
  loadPlayCounts().then(renderAll);
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('#games-filters .tag-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  renderAll();
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

function toast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show ' + (type || '');
  setTimeout(() => { t.className = ''; }, 2400);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('game-modal')?.classList.contains('open')) closeGame();
});
