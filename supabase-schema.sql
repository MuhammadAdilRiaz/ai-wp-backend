-- ─────────────────────────────────────────────────────────────────────────────
-- AI WP Builder — Supabase Schema
-- Run this entire file in your Supabase project → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. PROFILES — one row per user, stores credits and plan
create table if not exists profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    email       text not null,
    credits     integer not null default 100,
    plan        text not null default 'free',  -- free | starter | pro | agency
    created_at  timestamptz default now()
);

-- 2. SITES — connected WordPress sites
create table if not exists sites (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(id) on delete cascade,
    site_url    text not null,
    site_token  text not null,
    site_name   text,
    elementor   boolean default false,
    connected   boolean default true,
    updated_at  timestamptz default now(),
    unique(user_id, site_url)
);

-- 3. CONVERSATIONS — full chat history per site
create table if not exists conversations (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(id) on delete cascade,
    site_id     uuid references sites(id) on delete cascade,
    role        text not null check (role in ('user', 'assistant')),
    content     text not null,
    metadata    jsonb,  -- stores actions and results for assistant messages
    created_at  timestamptz default now()
);

-- 4. CREDIT TRANSACTIONS — every credit change logged here
create table if not exists credit_transactions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(id) on delete cascade,
    amount      integer not null,   -- positive = added, negative = used
    type        text not null,      -- grant | usage | purchase | refund
    description text,
    created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: deduct_credits (atomic — prevents going below 0)
-- Called by the backend after every chat message
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function deduct_credits(p_user_id uuid, p_amount integer)
returns void language plpgsql as $$
begin
    update profiles
    set    credits = greatest(0, credits - p_amount)
    where  id = p_user_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — users can only see their own data
-- ─────────────────────────────────────────────────────────────────────────────
alter table profiles      enable row level security;
alter table sites         enable row level security;
alter table conversations enable row level security;
alter table credit_transactions enable row level security;

-- Profiles: only own row
create policy "own profile" on profiles
    for all using (auth.uid() = id);

-- Sites: only own sites
create policy "own sites" on sites
    for all using (auth.uid() = user_id);

-- Conversations: only own conversations
create policy "own conversations" on conversations
    for all using (auth.uid() = user_id);

-- Credit transactions: only own transactions
create policy "own transactions" on credit_transactions
    for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES for fast queries
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_sites_user           on sites(user_id);
create index if not exists idx_conversations_site   on conversations(site_id);
create index if not exists idx_conversations_user   on conversations(user_id);
create index if not exists idx_transactions_user    on credit_transactions(user_id);
