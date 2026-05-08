/* ════════════════════════════════════════════
   CougSpot — Social Layer
   Profiles · Follows · Friends · Messages · Reactions · Theme
   Depends on the global `sb` Supabase client and `currentUser`
   from app.js. Functions exposed on window so inline onclicks work.
   ════════════════════════════════════════════ */
(function(){

/* ── Local helpers ───────────────────────────── */
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1) return 'just now';
  if (m < 60) return m+'m';
  const h = Math.floor(m/60);
  if (h < 24) return h+'h';
  const d = Math.floor(h/24);
  if (d < 7) return d+'d';
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function $(sel, root) { return (root||document).querySelector(sel); }
function $$(sel, root) { return Array.from((root||document).querySelectorAll(sel)); }
function getUid() { return window.currentUser?.id || null; }
function getUname() { return window.currentUser?.user_metadata?.username || 'user'; }

/* ── State ───────────────────────────────────── */
const state = {
  profile: null,            // own profile row
  profilesCache: {},        // id -> profile
  reactionsByPost: {},      // post_id -> [reactions]
  pendingDeletes: {},       // post_id -> timeoutId
  threads: [],              // [{otherId, otherProfile, lastMessage, unread}]
  activeThreadWith: null,   // user id of currently open thread
  threadMessages: [],
  threadChannel: null,
  globalMsgChannel: null,
  friendChannel: null,
  reactionChannel: null,
  unreadMessages: 0,
  pendingFriendRequests: 0,
};

const REACTION_SET = ['👍','❤️','😂','🔥','😮','😢'];
const EMOJI_PICKER = [
  '🦁','🐯','🐻','🐼','🦊','🐺','🐶','🐱',
  '🐵','🐸','🐧','🦄','🌈','⚡','🔥','💎',
  '🌸','🌻','🍀','🍕','🍔','🍦','⚽','🏀',
  '🎮','🎧','🎨','📚','🚀','✨','😎','💯'
];

/* ── Theme ───────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('cougspot-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cougspot-theme', next);
}

/* ── Profiles ────────────────────────────────── */
function initialsOf(p) {
  const src = p?.display_name || p?.username || '?';
  return src.slice(0,2).toUpperCase();
}
function avatarHTML(profile, size) {
  size = size || 'sm';
  const emoji = profile?.avatar_emoji;
  const cls = emoji ? 'soc-avatar is-emoji size-'+size : 'soc-avatar size-'+size;
  const inner = emoji ? escHtml(emoji) : escHtml(initialsOf(profile));
  return `<div class="${cls}">${inner}</div>`;
}

async function bootstrapProfile() {
  const uid = getUid();
  if (!uid) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (data) { state.profile = data; state.profilesCache[uid] = data; return data; }
  // No row: create one. Username may collide with someone else's, so retry with a suffix.
  const base = getUname();
  let attempt = 0;
  while (attempt < 4) {
    const uname = attempt === 0 ? base : `${base}_${uid.slice(0,4)}${attempt>1?attempt:''}`;
    const { data: created, error } = await sb.from('profiles').insert({
      id: uid, username: uname, display_name: uname, avatar_emoji: null,
    }).select().single();
    if (created) { state.profile = created; state.profilesCache[uid] = created; return created; }
    if (error && /duplicate|unique/i.test(error.message || '')) { attempt++; continue; }
    break;
  }
  return null;
}

async function loadProfile(userId) {
  if (state.profilesCache[userId]) return state.profilesCache[userId];
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (data) { state.profilesCache[userId] = data; return data; }
  // Self-heal: if it's me, bootstrap. Otherwise synthesize a minimal stub
  // from any post this user has authored so the UI never shows "not found".
  if (userId === getUid()) {
    const created = await bootstrapProfile();
    if (created) return created;
  }
  const { data: post } = await sb.from('posts')
    .select('username').eq('user_id', userId).not('is_anon','is',true)
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
  const stub = {
    id: userId,
    username: post?.username || 'user',
    display_name: post?.username || 'User',
    bio: null,
    avatar_emoji: null,
    _stub: true,
  };
  state.profilesCache[userId] = stub;
  return stub;
}

async function loadProfilesBulk(ids) {
  const need = ids.filter(id => id && !state.profilesCache[id]);
  if (!need.length) return;
  const { data } = await sb.from('profiles').select('*').in('id', need);
  (data||[]).forEach(p => { state.profilesCache[p.id] = p; });
}

async function openProfileView(userId) {
  const me = getUid();
  if (!userId) userId = me;
  const profile = await loadProfile(userId);
  if (!profile) { window.toast && window.toast('Could not load profile. Try again.', 'error'); return; }

  // Counts + relationship
  const [{ count: followersCount }, { count: followingCount }, friendStatus] = await Promise.all([
    sb.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
    sb.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
    getFriendStatus(userId),
  ]);
  let amFollowing = false;
  if (me && me !== userId) {
    const { data: f } = await sb.from('follows').select('follower_id').eq('follower_id', me).eq('following_id', userId).maybeSingle();
    amFollowing = !!f;
  }

  const isMe = me === userId;
  const html = `
    <div class="soc-profile-card">
      ${avatarHTML(profile, 'xl')}
      <h2 class="soc-profile-name">${escHtml(profile.display_name || profile.username)}</h2>
      <p class="soc-profile-handle">@${escHtml(profile.username)}</p>
      ${profile.bio ? `<p class="soc-profile-bio">${escHtml(profile.bio)}</p>` : ''}
      <div class="soc-stats">
        <div class="soc-stat"><span class="soc-stat-num">${followersCount||0}</span><span class="soc-stat-lbl">Followers</span></div>
        <div class="soc-stat"><span class="soc-stat-num">${followingCount||0}</span><span class="soc-stat-lbl">Following</span></div>
        <div class="soc-stat"><span class="soc-stat-num">${friendStatus.acceptedCount||0}</span><span class="soc-stat-lbl">Friends</span></div>
      </div>
      <div class="soc-action-row">
        ${isMe
          ? `<button class="soc-btn primary" style="flex:1" onclick="SocialLayer.openProfileEditor()">Edit profile</button>`
          : `
            <button class="soc-btn soc-follow-btn" data-state="${amFollowing?'following':'idle'}" data-target="${userId}" onclick="SocialLayer.toggleFollow('${userId}', this)">${amFollowing?'Following':'Follow'}</button>
            <button class="soc-btn soc-friend-btn" data-state="${friendStatus.state}" data-target="${userId}" onclick="SocialLayer.handleFriendAction('${userId}', this)">${friendLabel(friendStatus.state)}</button>
            <button class="soc-btn ghost" onclick="SocialLayer.openThreadWith('${userId}')">Message</button>
          `}
      </div>
    </div>`;
  $('#profile-view-body').innerHTML = html;
  openSheet('profile-view');
}

function friendLabel(s) {
  switch (s) {
    case 'accepted': return 'Friends';
    case 'pending':  return 'Requested';
    case 'incoming': return 'Accept';
    default: return 'Add friend';
  }
}

/* ── Profile editor ───────────────────────────── */
async function openProfileEditor() {
  await bootstrapProfile();
  const p = state.profile || {};
  $('#pe-display').value = p.display_name || '';
  $('#pe-bio').value = p.bio || '';
  $('#pe-charcount').textContent = (p.bio||'').length + '/160';
  renderEmojiPicker(p.avatar_emoji || '');
  renderEditorAvatar(p);
  closeSheet('profile-view');
  openSheet('profile-editor');
}
function renderEmojiPicker(selected) {
  const grid = $('#pe-emoji-grid');
  grid.innerHTML =
    `<button type="button" class="soc-emoji-cell ${!selected?'selected':''}" onclick="SocialLayer.selectEmoji('')" title="Use initials">Aa</button>` +
    EMOJI_PICKER.map(e => `<button type="button" class="soc-emoji-cell ${selected===e?'selected':''}" onclick="SocialLayer.selectEmoji('${e}')">${e}</button>`).join('');
}
function renderEditorAvatar(p) {
  $('#pe-avatar').innerHTML = avatarHTML(p, 'xl');
}
function selectEmoji(e) {
  const p = state.profile || {};
  p.avatar_emoji = e || null;
  state.profile = p;
  renderEmojiPicker(e);
  const av = $('#pe-avatar');
  if (av) {
    av.innerHTML = avatarHTML(p, 'xl');
    const inner = av.querySelector('.soc-avatar');
    if (inner) { inner.classList.add('bounce'); setTimeout(()=>inner.classList.remove('bounce'), 700); }
  }
}
async function saveProfile() {
  const uid = getUid(); if (!uid) return;
  const display = $('#pe-display').value.trim().slice(0,40);
  const bio = $('#pe-bio').value.trim().slice(0,160);
  const emoji = state.profile?.avatar_emoji || null;
  const prev = state.profile;
  state.profile = { ...prev, display_name: display, bio, avatar_emoji: emoji };
  state.profilesCache[uid] = state.profile;
  refreshNavAvatar();
  closeSheet('profile-editor');
  window.toast && window.toast('Profile saved.', 'success');
  const { error } = await sb.from('profiles').update({
    display_name: display, bio, avatar_emoji: emoji, updated_at: new Date().toISOString(),
  }).eq('id', uid);
  if (error) {
    state.profile = prev; state.profilesCache[uid] = prev;
    refreshNavAvatar();
    window.toast && window.toast('Could not save profile.', 'error');
  }
}
function bindEditorEvents() {
  const bio = $('#pe-bio');
  if (bio && !bio.dataset.bound) {
    bio.dataset.bound = '1';
    bio.addEventListener('input', () => {
      $('#pe-charcount').textContent = bio.value.length + '/160';
    });
  }
}

function refreshNavAvatar() {
  const el = $('#nav-soc-avatar');
  if (el) el.innerHTML = avatarHTML(state.profile, 'sm');
}

/* ── Follows ─────────────────────────────────── */
async function toggleFollow(targetId, btn) {
  const me = getUid(); if (!me || me === targetId) return;
  const cur = btn.dataset.state;
  const wantFollow = cur !== 'following';
  // optimistic
  btn.dataset.state = wantFollow ? 'following' : 'idle';
  btn.textContent = wantFollow ? 'Following' : 'Follow';
  if (wantFollow) {
    const { error } = await sb.from('follows').insert({ follower_id: me, following_id: targetId });
    if (error) {
      btn.dataset.state = 'idle'; btn.textContent = 'Follow';
      window.toast && window.toast('Could not follow.', 'error');
    }
  } else {
    const { error } = await sb.from('follows').delete().eq('follower_id', me).eq('following_id', targetId);
    if (error) {
      btn.dataset.state = 'following'; btn.textContent = 'Following';
      window.toast && window.toast('Could not unfollow.', 'error');
    }
  }
}

/* ── Friends ─────────────────────────────────── */
async function getFriendStatus(otherId) {
  const me = getUid();
  if (!me || !otherId || me === otherId) return { state: 'self', acceptedCount: 0 };
  const { data } = await sb.from('friendships').select('*')
    .or(`and(requester_id.eq.${me},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${me})`)
    .maybeSingle();
  let s = 'idle';
  if (data) {
    if (data.status === 'accepted') s = 'accepted';
    else if (data.status === 'pending') s = data.requester_id === me ? 'pending' : 'incoming';
    else if (data.status === 'declined') s = 'idle';
  }
  // Friend count for the "other" user (accepted only)
  const { count } = await sb.from('friendships').select('*', { count: 'exact', head: true })
    .or(`requester_id.eq.${otherId},addressee_id.eq.${otherId}`).eq('status','accepted');
  return { state: s, row: data, acceptedCount: count || 0 };
}

async function handleFriendAction(otherId, btn) {
  const me = getUid(); if (!me) return;
  const cur = btn.dataset.state;
  if (cur === 'idle') {
    btn.dataset.state = 'pending'; btn.textContent = friendLabel('pending');
    const { error } = await sb.from('friendships').insert({ requester_id: me, addressee_id: otherId, status: 'pending' });
    if (error) { btn.dataset.state = 'idle'; btn.textContent = friendLabel('idle'); window.toast && window.toast('Could not send request.', 'error'); }
    else window.toast && window.toast('Friend request sent.', 'success');
  } else if (cur === 'pending') {
    // cancel
    btn.dataset.state = 'idle'; btn.textContent = friendLabel('idle');
    await sb.from('friendships').delete().eq('requester_id', me).eq('addressee_id', otherId);
  } else if (cur === 'incoming') {
    btn.dataset.state = 'accepted'; btn.textContent = friendLabel('accepted');
    const { error } = await sb.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('requester_id', otherId).eq('addressee_id', me);
    if (error) { btn.dataset.state = 'incoming'; btn.textContent = friendLabel('incoming'); window.toast && window.toast('Could not accept.', 'error'); }
    else window.toast && window.toast('Friends!', 'success');
  } else if (cur === 'accepted') {
    if (!confirm('Remove friend?')) return;
    btn.dataset.state = 'idle'; btn.textContent = friendLabel('idle');
    await sb.from('friendships').delete()
      .or(`and(requester_id.eq.${me},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${me})`);
  }
  refreshNotifications();
}

async function declineFriend(otherId) {
  const me = getUid(); if (!me) return;
  await sb.from('friendships').update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('requester_id', otherId).eq('addressee_id', me);
  loadFriendsScreen();
  refreshNotifications();
}

async function loadFriendsScreen() {
  const me = getUid(); if (!me) return;
  showSocScreen('friends');
  const incomingEl = $('#friends-incoming');
  const acceptedEl = $('#friends-accepted');
  const outgoingEl = $('#friends-outgoing');
  incomingEl.innerHTML = skeletonRows(2);
  acceptedEl.innerHTML = skeletonRows(2);
  outgoingEl.innerHTML = skeletonRows(1);

  const { data } = await sb.from('friendships').select('*')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order('created_at', { ascending: false });

  const rows = data || [];
  const ids = new Set();
  rows.forEach(r => { ids.add(r.requester_id); ids.add(r.addressee_id); });
  await loadProfilesBulk(Array.from(ids));

  const incoming = rows.filter(r => r.status === 'pending' && r.addressee_id === me);
  const outgoing = rows.filter(r => r.status === 'pending' && r.requester_id === me);
  const accepted = rows.filter(r => r.status === 'accepted');

  incomingEl.innerHTML = incoming.length ? incoming.map(r => {
    const p = state.profilesCache[r.requester_id] || { username: '…' };
    return `<div class="soc-row">
      ${avatarHTML(p,'sm')}
      <div class="grow"><div class="name">${escHtml(p.display_name||p.username)}</div><div class="sub">@${escHtml(p.username)} · wants to be friends</div></div>
      <div class="actions">
        <button class="soc-btn primary" style="height:34px;min-width:80px" onclick="SocialLayer.acceptFriend('${r.requester_id}')">Accept</button>
        <button class="soc-btn ghost" style="height:34px;min-width:70px" onclick="SocialLayer.declineFriend('${r.requester_id}')">Decline</button>
      </div>
    </div>`;
  }).join('') : emptyStateHTML('💌','No requests', 'New friend requests will show up here.');

  acceptedEl.innerHTML = accepted.length ? accepted.map(r => {
    const otherId = r.requester_id === me ? r.addressee_id : r.requester_id;
    const p = state.profilesCache[otherId] || { username: '…' };
    return `<div class="soc-row" onclick="SocialLayer.openProfileView('${otherId}')">
      ${avatarHTML(p,'sm')}
      <div class="grow"><div class="name">${escHtml(p.display_name||p.username)}</div><div class="sub">@${escHtml(p.username)}</div></div>
      <div class="actions">
        <button class="soc-btn ghost" style="height:34px;min-width:90px" onclick="event.stopPropagation();SocialLayer.openThreadWith('${otherId}')">Message</button>
      </div>
    </div>`;
  }).join('') : emptyStateHTML('🤝','No friends yet','Find people in the feed and tap their avatar to send a request.');

  outgoingEl.innerHTML = outgoing.length ? outgoing.map(r => {
    const p = state.profilesCache[r.addressee_id] || { username: '…' };
    return `<div class="soc-row">
      ${avatarHTML(p,'sm')}
      <div class="grow"><div class="name">${escHtml(p.display_name||p.username)}</div><div class="sub">@${escHtml(p.username)} · pending</div></div>
      <div class="actions">
        <button class="soc-btn ghost" style="height:34px;min-width:80px" onclick="SocialLayer.cancelFriendRequest('${r.addressee_id}')">Cancel</button>
      </div>
    </div>`;
  }).join('') : '';
}

async function acceptFriend(requesterId) {
  const me = getUid(); if (!me) return;
  await sb.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('requester_id', requesterId).eq('addressee_id', me);
  loadFriendsScreen();
  refreshNotifications();
}
async function cancelFriendRequest(addresseeId) {
  const me = getUid(); if (!me) return;
  await sb.from('friendships').delete().eq('requester_id', me).eq('addressee_id', addresseeId);
  loadFriendsScreen();
}

/* ── Messages ────────────────────────────────── */
async function loadMessagesScreen() {
  const me = getUid(); if (!me) return;
  showSocScreen('messages');
  const list = $('#threads-list');
  list.innerHTML = skeletonRows(4);

  const { data } = await sb.from('messages').select('*')
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(200);

  const map = new Map();
  (data||[]).forEach(m => {
    const other = m.sender_id === me ? m.recipient_id : m.sender_id;
    if (!map.has(other)) map.set(other, { otherId: other, last: m, unread: 0 });
    if (m.recipient_id === me && !m.read_at) map.get(other).unread++;
  });

  const ids = Array.from(map.keys());
  await loadProfilesBulk(ids);

  if (!ids.length) {
    list.innerHTML = emptyStateHTML('✉️','No messages yet','Open a profile and tap Message to start a conversation.');
    return;
  }
  list.innerHTML = Array.from(map.values()).map(t => {
    const p = state.profilesCache[t.otherId] || { username: '…' };
    const fromMe = t.last.sender_id === me;
    const preview = (fromMe ? 'You: ' : '') + (t.last.content || '');
    return `<div class="soc-row" onclick="SocialLayer.openThreadWith('${t.otherId}')">
      ${avatarHTML(p,'md')}
      <div class="grow">
        <div class="name">${escHtml(p.display_name||p.username)} ${t.unread? `<span class="notif-dot show" style="position:static;margin-left:6px">${t.unread}</span>`:''}</div>
        <div class="sub">${escHtml(preview).slice(0,80)}</div>
      </div>
      <div class="sub" style="white-space:nowrap">${timeAgo(t.last.created_at)}</div>
    </div>`;
  }).join('');
}

async function openThreadWith(otherId) {
  const me = getUid(); if (!me) return;
  const other = await loadProfile(otherId);
  state.activeThreadWith = otherId;
  $('#thread-title').textContent = other ? (other.display_name || other.username) : '…';
  $('#thread-sub').textContent = other ? '@' + other.username : '';
  $('#thread-avatar').innerHTML = avatarHTML(other,'md');
  $('#thread-body').innerHTML = '<div style="padding:20px">'+skeletonBubbles(3)+'</div>';
  closeSheet('profile-view');
  openSheet('thread');

  const { data } = await sb.from('messages').select('*')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`)
    .order('created_at', { ascending: true })
    .limit(200);
  state.threadMessages = data || [];
  renderThread();
  // mark read
  await sb.from('messages').update({ read_at: new Date().toISOString() })
    .eq('sender_id', otherId).eq('recipient_id', me).is('read_at', null);
  refreshNotifications();

  // realtime per-thread channel
  if (state.threadChannel) sb.removeChannel(state.threadChannel);
  state.threadChannel = sb.channel('thread-'+[me,otherId].sort().join('-'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      const m = payload.new;
      const ours = (m.sender_id === me && m.recipient_id === otherId) || (m.sender_id === otherId && m.recipient_id === me);
      if (!ours) return;
      if (state.threadMessages.find(x => x.id === m.id)) return;
      state.threadMessages.push(m);
      renderThread();
      if (m.sender_id === otherId) {
        sb.from('messages').update({ read_at: new Date().toISOString() }).eq('id', m.id);
      }
    })
    .subscribe();
}

function renderThread() {
  const me = getUid();
  const body = $('#thread-body');
  if (!state.threadMessages.length) {
    body.innerHTML = emptyStateHTML('👋','Say hi','Send the first message to start the conversation.');
    return;
  }
  body.innerHTML = '<div class="soc-thread">' +
    state.threadMessages.map(m => {
      const out = m.sender_id === me;
      const read = out && m.read_at ? '· read' : '';
      return `<div class="bubble ${out?'out':'in'}">${escHtml(m.content)}<span class="meta">${timeAgo(m.created_at)} ${read}</span></div>`;
    }).join('') + '</div>';
  // scroll to bottom
  const scroller = body.querySelector('.soc-thread');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

async function sendMessage() {
  const me = getUid(); const other = state.activeThreadWith;
  if (!me || !other) return;
  const input = $('#thread-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  // optimistic
  const tempId = 'temp-'+Date.now();
  const optimistic = { id: tempId, sender_id: me, recipient_id: other, content, created_at: new Date().toISOString(), read_at: null };
  state.threadMessages.push(optimistic);
  renderThread();
  const { data, error } = await sb.from('messages').insert({ sender_id: me, recipient_id: other, content }).select().single();
  if (error) {
    state.threadMessages = state.threadMessages.filter(m => m.id !== tempId);
    renderThread();
    window.toast && window.toast('Could not send.', 'error');
    input.value = content;
  } else {
    const idx = state.threadMessages.findIndex(m => m.id === tempId);
    if (idx >= 0) state.threadMessages[idx] = data;
    renderThread();
  }
}

function threadInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

/* ── Reactions ───────────────────────────────── */
async function hydratePosts() {
  const cards = $$('.post-card[data-post-id]');
  if (!cards.length) return;
  const me = getUid();
  const ids = cards.map(c => c.dataset.postId);
  if (!ids.length) return;
  const { data } = await sb.from('reactions').select('*').in('post_id', ids);
  const grouped = {};
  (data||[]).forEach(r => { (grouped[r.post_id] = grouped[r.post_id] || []).push(r); });
  state.reactionsByPost = grouped;
  cards.forEach(card => {
    const pid = card.dataset.postId;
    const ownerId = card.dataset.userId;
    // reactions
    const bar = card.querySelector('.post-reactions');
    if (bar) bar.innerHTML = renderReactionsBar(pid, grouped[pid] || [], me);
    // owner actions
    const oa = card.querySelector('.post-owner-actions');
    if (oa && ownerId && ownerId === me) {
      oa.innerHTML = `
        <button class="post-menu-btn" onclick="SocialLayer.togglePostMenu('${pid}', event)" aria-label="Post options">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
        </button>
        <div class="post-menu-pop" id="post-menu-${pid}">
          <button class="post-menu-item danger" onclick="SocialLayer.requestDeletePost('${pid}')">Delete post</button>
        </div>`;
    } else if (oa) {
      oa.innerHTML = '';
    }
  });
}

function renderReactionsBar(postId, reactions, me) {
  const counts = {};
  const mine = new Set();
  reactions.forEach(r => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (r.user_id === me) mine.add(r.emoji);
  });
  return REACTION_SET.map(e => {
    const c = counts[e] || 0;
    const active = mine.has(e);
    return `<button class="soc-reaction ${active?'active':''}" data-post="${postId}" data-emoji="${e}" onclick="SocialLayer.toggleReaction('${postId}','${e}', this)">
      <span>${e}</span>${c?`<span class="count">${c}</span>`:''}
    </button>`;
  }).join('');
}

async function toggleReaction(postId, emoji, btn) {
  const me = getUid(); if (!me) return;
  const list = state.reactionsByPost[postId] || (state.reactionsByPost[postId] = []);
  const existing = list.find(r => r.user_id === me && r.emoji === emoji);
  btn.classList.add('bump');
  setTimeout(() => btn.classList.remove('bump'), 480);
  if (existing) {
    // optimistic remove
    state.reactionsByPost[postId] = list.filter(r => r !== existing);
    rerenderBar(postId);
    const { error } = await sb.from('reactions').delete().eq('post_id', postId).eq('user_id', me).eq('emoji', emoji);
    if (error) { state.reactionsByPost[postId].push(existing); rerenderBar(postId); }
  } else {
    const optimistic = { id: 'temp-'+Date.now(), post_id: postId, user_id: me, emoji };
    list.push(optimistic);
    rerenderBar(postId);
    const { data, error } = await sb.from('reactions').insert({ post_id: postId, user_id: me, emoji }).select().single();
    if (error) {
      state.reactionsByPost[postId] = list.filter(r => r !== optimistic);
      rerenderBar(postId);
    } else {
      const idx = state.reactionsByPost[postId].indexOf(optimistic);
      if (idx >= 0) state.reactionsByPost[postId][idx] = data;
    }
  }
}

function rerenderBar(postId) {
  const card = document.getElementById('post-'+postId);
  if (!card) return;
  const bar = card.querySelector('.post-reactions');
  if (bar) bar.innerHTML = renderReactionsBar(postId, state.reactionsByPost[postId] || [], getUid());
}

/* ── Post delete (with undo) ─────────────────── */
function togglePostMenu(postId, ev) {
  ev && ev.stopPropagation();
  $$('.post-menu-pop.open').forEach(m => { if (m.id !== 'post-menu-'+postId) m.classList.remove('open'); });
  const m = document.getElementById('post-menu-'+postId);
  if (m) m.classList.toggle('open');
}
document.addEventListener('click', () => { $$('.post-menu-pop.open').forEach(m => m.classList.remove('open')); });

function requestDeletePost(postId) {
  const card = document.getElementById('post-'+postId);
  if (!card) return;
  $$('.post-menu-pop.open').forEach(m => m.classList.remove('open'));
  card.classList.add('collapsing');
  // show undo toast
  const undo = document.createElement('div');
  undo.className = 'soc-undo-toast';
  undo.id = 'undo-'+postId;
  undo.innerHTML = `<span>Post deleted</span><button class="soc-btn ghost" onclick="SocialLayer.undoDelete('${postId}')">Undo</button>`;
  document.body.appendChild(undo);
  requestAnimationFrame(() => undo.classList.add('show'));
  state.pendingDeletes[postId] = setTimeout(async () => {
    delete state.pendingDeletes[postId];
    undo.classList.remove('show');
    setTimeout(() => undo.remove(), 360);
    await sb.from('posts').delete().eq('id', postId);
    if (card.parentNode) card.remove();
  }, 5000);
}
function undoDelete(postId) {
  clearTimeout(state.pendingDeletes[postId]);
  delete state.pendingDeletes[postId];
  const card = document.getElementById('post-'+postId);
  if (card) card.classList.remove('collapsing');
  const undo = document.getElementById('undo-'+postId);
  if (undo) { undo.classList.remove('show'); setTimeout(() => undo.remove(), 360); }
}

/* ── Notifications ───────────────────────────── */
async function refreshNotifications() {
  const me = getUid(); if (!me) return;
  const [{ count: msgUnread }, { count: friendPending }] = await Promise.all([
    sb.from('messages').select('*', { count: 'exact', head: true }).eq('recipient_id', me).is('read_at', null),
    sb.from('friendships').select('*', { count: 'exact', head: true }).eq('addressee_id', me).eq('status','pending'),
  ]);
  state.unreadMessages = msgUnread || 0;
  state.pendingFriendRequests = friendPending || 0;
  const md = $('#dot-messages');
  const fd = $('#dot-friends');
  if (md) { if (state.unreadMessages > 0) { md.classList.add('show'); md.textContent = state.unreadMessages; } else md.classList.remove('show'); }
  if (fd) { if (state.pendingFriendRequests > 0) { fd.classList.add('show'); fd.textContent = state.pendingFriendRequests; } else fd.classList.remove('show'); }
}

/* ── Realtime ────────────────────────────────── */
function subscribeSocialRealtime() {
  const me = getUid(); if (!me) return;
  if (state.globalMsgChannel) sb.removeChannel(state.globalMsgChannel);
  state.globalMsgChannel = sb.channel('soc-msg-'+me)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${me}` }, () => {
      refreshNotifications();
    })
    .subscribe();
  if (state.friendChannel) sb.removeChannel(state.friendChannel);
  state.friendChannel = sb.channel('soc-friends-'+me)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
      refreshNotifications();
    })
    .subscribe();
  if (state.reactionChannel) sb.removeChannel(state.reactionChannel);
  state.reactionChannel = sb.channel('soc-reactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, payload => {
      const r = payload.new || payload.old;
      if (!r) return;
      const card = document.getElementById('post-'+r.post_id);
      if (!card) return;
      const list = state.reactionsByPost[r.post_id] = state.reactionsByPost[r.post_id] || [];
      if (payload.eventType === 'INSERT') {
        if (!list.find(x => x.id === r.id)) list.push(r);
      } else if (payload.eventType === 'DELETE') {
        state.reactionsByPost[r.post_id] = list.filter(x => x.id !== r.id);
      }
      rerenderBar(r.post_id);
    })
    .subscribe();
}

/* ── Sheets / Screens ────────────────────────── */
function openSheet(name) {
  const el = document.getElementById('sheet-'+name) || document.getElementById('modal-'+name);
  if (el) el.classList.add('open');
  if (name === 'profile-editor') bindEditorEvents();
}
function closeSheet(name) {
  const el = document.getElementById('sheet-'+name) || document.getElementById('modal-'+name);
  if (el) el.classList.remove('open');
  if (name === 'thread' && state.threadChannel) {
    sb.removeChannel(state.threadChannel); state.threadChannel = null; state.activeThreadWith = null;
  }
}

function showSocScreen(name) {
  // hide existing app screens
  $$('.screen').forEach(s => s.classList.remove('active'));
  $$('.soc-screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-'+name);
  if (el) el.classList.add('active');
}
function backToHome() {
  $$('.soc-screen').forEach(s => s.classList.remove('active'));
  const home = document.getElementById('screen-home');
  if (home) home.classList.add('active');
}

/* ── Skeletons / Empty ───────────────────────── */
function skeletonRows(n) {
  let out = ''; for (let i=0;i<n;i++) out += '<div class="soc-skel row"></div>';
  return out;
}
function skeletonBubbles(n) {
  let out = '';
  for (let i=0;i<n;i++) out += `<div class="soc-skel bubble ${i%2?'right':''}"></div>`;
  return out;
}
function emptyStateHTML(ico, title, body) {
  return `<div class="soc-empty"><div class="ico">${ico}</div><h3>${escHtml(title)}</h3><p>${escHtml(body)}</p></div>`;
}

/* ── Init ────────────────────────────────────── */
async function init() {
  initTheme();
  if (!getUid()) return;
  await bootstrapProfile();
  refreshNavAvatar();
  subscribeSocialRealtime();
  refreshNotifications();
  // hydrate any posts already on page
  setTimeout(hydratePosts, 250);
}

/* ── Public API ──────────────────────────────── */
window.SocialLayer = {
  init,
  hydratePosts,
  toggleTheme,
  openProfileView,
  openProfileEditor,
  saveProfile,
  selectEmoji,
  toggleFollow,
  handleFriendAction,
  acceptFriend,
  declineFriend,
  cancelFriendRequest,
  loadFriendsScreen,
  loadMessagesScreen,
  openThreadWith,
  sendMessage,
  threadInputKey,
  toggleReaction,
  togglePostMenu,
  requestDeletePost,
  undoDelete,
  closeSheet,
  openSheet,
  backToHome,
};

})();
