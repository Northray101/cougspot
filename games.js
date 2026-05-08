/* ========================================
   CougSpot — Games Library
======================================== */

const SUPABASE_URL  = 'https://dqcyecscdelfikbimnpw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3llY3NjZGVsZmlrYmltbnB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzIwOTUsImV4cCI6MjA5Mzc0ODA5NX0.PIl0Syj--UQNjtMKNjAWmisYwOA50Aw5ICNv6J-UNDQ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let currentFilter = 'all';
let playCounts = {};

const ROM = (file, system) =>
  `games/emulator.html?system=${system}&rom=${encodeURIComponent('games/roms/' + file)}`;

const GAMES = [
  // ── HTML5 Classics ──────────────────────────────────────────────────────
  { id: '2048',   name: '2048',        category: 'html5',  addedAt: '2026-05-08',
    src: 'games/2048/index.html',   thumb: 'games/thumbs/2048.svg',      icon: '🔢', desc: 'Slide tiles to reach 2048.' },
  { id: 'snake',  name: 'Snake',       category: 'html5',  addedAt: '2026-05-08',
    src: 'games/snake/index.html',  thumb: 'games/thumbs/snake.svg',     icon: '🐍', desc: 'Eat apples, grow, survive.' },
  { id: 'tetris', name: 'Tetris',      category: 'html5',  addedAt: '2026-05-08',
    src: 'games/tetris/index.html', thumb: 'games/thumbs/tetris.svg',    icon: '🧱', desc: 'Stack blocks, clear lines.' },
  { id: 'flappy', name: 'Flappy Bird', category: 'html5',  addedAt: '2026-05-08',
    src: 'games/flappy/index.html', thumb: 'games/thumbs/flappy.svg',    icon: '🐦', desc: 'Tap to fly through pipes.' },
  // ── Puzzle / Word ────────────────────────────────────────────────────────
  { id: 'wordle', name: 'Wordle',      category: 'puzzle', addedAt: '2026-05-08',
    src: 'games/wordle/index.html', thumb: 'games/thumbs/wordle.svg',    icon: '🟩', desc: 'Guess the 5-letter word in 6 tries.' },
  { id: 'sudoku', name: 'Sudoku',      category: 'puzzle', addedAt: '2026-05-08',
    src: 'games/sudoku/index.html', thumb: 'games/thumbs/sudoku.svg',    icon: '🔣', desc: 'Fill the 9×9 grid.' },
  // ── Retro — NES ──────────────────────────────────────────────────────────
  { id: 'mario-bros', name: 'Super Mario Bros.', category: 'retro', addedAt: '2026-05-08',
    src: ROM('Super Mario Bros. (World).nes', 'nes'),
    thumb: 'games/thumbs/mario-bros.svg', icon: '🍄', desc: 'The original NES classic — save Princess Peach.' },
  { id: 'tetris-nes', name: 'Tetris (NES)',       category: 'retro', addedAt: '2026-05-08',
    src: ROM('Tetris (USA).nes', 'nes'),
    thumb: 'games/thumbs/tetris-nes.svg', icon: '🟦', desc: 'The legendary NES version with Russian soundtrack.' },
  // ── Retro — SNES ─────────────────────────────────────────────────────────
  { id: 'mario-world', name: 'Super Mario World',       category: 'retro', addedAt: '2026-05-08',
    src: ROM('Super Mario World (USA).sfc', 'snes'),
    thumb: 'games/thumbs/mario-world.svg', icon: '🦕', desc: 'Explore Dinosaur Land with Mario and Yoshi.' },
  { id: 'zelda-lttp',  name: 'Zelda: A Link to the Past', category: 'retro', addedAt: '2026-05-08',
    src: ROM('Legend of Zelda, The - A Link to the Past (USA).sfc', 'snes'),
    thumb: 'games/thumbs/zelda-lttp.svg', icon: '🗡️', desc: 'Link battles Ganon across Hyrule and the Dark World.' },
  { id: 'megaman-x',   name: 'Mega Man X',               category: 'retro', addedAt: '2026-05-08',
    src: ROM('Mega Man X (USA) (Rev 1).sfc', 'snes'),
    thumb: 'games/thumbs/megaman-x.svg',  icon: '🤖', desc: 'Run, jump, and blast as X in a cyber future.' },
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
  const thumbHtml = game.thumb
    ? `<img src="${escHtml(game.thumb)}" alt="${escHtml(game.name)}" loading="lazy"
            onerror="this.parentElement.innerHTML='<span class=\\'thumb-icon\\'>${game.icon}</span>'">`
    : `<span class="thumb-icon">${game.icon}</span>`;
  const categoryLabel = { html5: 'HTML5', retro: 'Retro', puzzle: 'Puzzle' }[game.category] || game.category;
  return `
    <div class="game-card${dimmed}" onclick="openGame('${game.id}')" style="animation: fadeUp 400ms var(--ease) ${delay}ms both">
      <div class="game-thumb">${thumbHtml}</div>
      <div class="game-info">
        <div class="game-name-row">
          <span class="game-name">${escHtml(game.name)}</span>
          <span class="game-badge game-badge-${game.category}">${categoryLabel}</span>
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
