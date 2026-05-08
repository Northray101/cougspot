-- ════════════════════════════════════════════
-- CougSpot — Social Layer Migration
-- Profiles, Follows, Friendships, Messages, Reactions
-- All tables RLS-enforced. Realtime on conversation tables.
-- ════════════════════════════════════════════

-- ── PROFILES ─────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique,
  display_name  text,
  bio           text check (char_length(coalesce(bio,'')) <= 160),
  avatar_emoji  text check (char_length(coalesce(avatar_emoji,'')) between 0 and 4),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (username);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_auth" on public.profiles;
create policy "profiles_select_auth"
  on public.profiles for select
  to authenticated using (true);

drop policy if exists "profiles_update_owner" on public.profiles;
create policy "profiles_update_owner"
  on public.profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_owner" on public.profiles;
create policy "profiles_insert_owner"
  on public.profiles for insert
  to authenticated with check (auth.uid() = id);

-- Auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── FOLLOWS ──────────────────────────────────
create table if not exists public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx  on public.follows (follower_id);

alter table public.follows enable row level security;

drop policy if exists "follows_select_auth" on public.follows;
create policy "follows_select_auth" on public.follows
  for select to authenticated using (true);

drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self" on public.follows
  for insert to authenticated with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_self" on public.follows;
create policy "follows_delete_self" on public.follows
  for delete to authenticated using (auth.uid() = follower_id);

-- ── FRIENDSHIPS ──────────────────────────────
create table if not exists public.friendships (
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists friendships_addressee_idx on public.friendships (addressee_id);
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_status_idx    on public.friendships (status);

alter table public.friendships enable row level security;

drop policy if exists "friendships_select_party" on public.friendships;
create policy "friendships_select_party" on public.friendships
  for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester" on public.friendships
  for insert to authenticated
  with check (auth.uid() = requester_id);

drop policy if exists "friendships_update_party" on public.friendships;
create policy "friendships_update_party" on public.friendships
  for update to authenticated
  using (auth.uid() in (requester_id, addressee_id))
  with check (auth.uid() in (requester_id, addressee_id));

drop policy if exists "friendships_delete_party" on public.friendships;
create policy "friendships_delete_party" on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- ── MESSAGES ─────────────────────────────────
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  content       text not null check (char_length(content) between 1 and 2000),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_recipient_idx on public.messages (recipient_id, read_at);

alter table public.messages enable row level security;

drop policy if exists "messages_select_party" on public.messages;
create policy "messages_select_party" on public.messages
  for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));

drop policy if exists "messages_insert_sender" on public.messages;
create policy "messages_insert_sender" on public.messages
  for insert to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "messages_update_recipient" on public.messages;
create policy "messages_update_recipient" on public.messages
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- ── REACTIONS ────────────────────────────────
create table if not exists public.reactions (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 8),
  created_at  timestamptz not null default now(),
  unique (post_id, user_id, emoji)
);

create index if not exists reactions_post_idx on public.reactions (post_id);
create index if not exists reactions_user_idx on public.reactions (user_id);

alter table public.reactions enable row level security;

drop policy if exists "reactions_select_auth" on public.reactions;
create policy "reactions_select_auth" on public.reactions
  for select to authenticated using (true);

drop policy if exists "reactions_insert_self" on public.reactions;
create policy "reactions_insert_self" on public.reactions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "reactions_delete_self" on public.reactions;
create policy "reactions_delete_self" on public.reactions
  for delete to authenticated using (auth.uid() = user_id);

-- ── POSTS: enable RLS + owner-delete policy ──
alter table public.posts enable row level security;

drop policy if exists "posts_select_all" on public.posts;
create policy "posts_select_all" on public.posts
  for select to authenticated using (true);

drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self" on public.posts
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "posts_delete_owner" on public.posts;
create policy "posts_delete_owner" on public.posts
  for delete to authenticated
  using (auth.uid() = user_id);

-- ── REALTIME PUBLICATION ─────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.friendships;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.follows;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.reactions;
  exception when duplicate_object then null; end;
end $$;
