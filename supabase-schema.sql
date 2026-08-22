-- ─────────────────────────────────────────────────────────────────────────────
-- AI WP Builder — Supabase Schema
-- Run this entire file in your Supabase project → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. PROFILES — one row per user, stores credits and plan
create table if not exists profiles (
    id             uuid primary key references auth.users(id) on delete cascade,
    email          text not null,
    credits        integer not null default 0,     -- REAL credits; granted by auth.js (trial) or your billing webhook (paid plans)
    plan           text not null default 'trial',  -- trial | starter | pro | business
    trial_ends_at  timestamptz,                     -- set at signup; see src/lib/plans.js TRIAL.days
    billing_cycle  text default 'monthly',          -- monthly | yearly — set when they pick a paid plan
    created_at     timestamptz default now()
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

-- 5. CHAT SESSIONS — sidebar threads. Referenced by src/routes/chat.js but was
--    missing from this schema, which means /api/chat/message and
--    /api/chat/sessions would fail on a fresh database. Adding it here.
create table if not exists chat_sessions (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references profiles(id) on delete cascade,
    site_id          uuid references sites(id) on delete cascade,
    title            text,
    created_at       timestamptz default now(),
    last_message_at  timestamptz default now()
);

alter table conversations add column if not exists session_id uuid references chat_sessions(id) on delete cascade;

-- 6. APP SETTINGS — key/value config read by src/lib/setting.js. Also missing
--    from the original schema (getSettings() would silently return {} and
--    every setting would fall back to its hardcoded default). Seeded here
--    with the numbers from the pricing calculator at ~75% gross margin.
--    Tune usd_per_real_credit from there whenever your token costs or
--    fixed infra bill changes — it's the one number that drives all pricing.
create table if not exists app_settings (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz default now()
);

-- If you're running this against a database that already has the OLD
-- profiles table (credits default 100, plan default 'free'), run these too:
alter table profiles add column if not exists trial_ends_at timestamptz;
alter table profiles add column if not exists billing_cycle text default 'monthly';

insert into app_settings (key, value) values
    ('usd_per_real_credit',        '0.005'),  -- SIZING unit ($ raw cost = 1 real credit), not a price — margin lives in src/lib/plans.js
    ('min_real_credits_per_message', '1'),    -- floor so a $0 question still costs something
    ('display_credit_multiplier',  '10')      -- kept here for reference/audit only; code uses src/lib/credits.js as the source of truth
on conflict (key) do nothing;

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
alter table chat_sessions enable row level security;

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

-- Chat sessions: only own sessions
create policy "own chat sessions" on chat_sessions
    for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES for fast queries
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_sites_user           on sites(user_id);
create index if not exists idx_conversations_site   on conversations(site_id);
create index if not exists idx_conversations_user   on conversations(user_id);
create index if not exists idx_conversations_session on conversations(session_id);
create index if not exists idx_transactions_user    on credit_transactions(user_id);
create index if not exists idx_chat_sessions_user   on chat_sessions(user_id, site_id);
