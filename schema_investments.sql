-- schema_investments.sql — adds money-market placement tracking.
-- Safe to run as many times as you like.
-- Run in your Supabase SQL Editor as a NEW query.

create table if not exists placements (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null,                -- Duval Properties, Metis Capital, ...
  currency      char(3) not null default 'NGN',
  start_date    date not null,
  principal     numeric(20,2) not null check (principal > 0),  -- full currency units
  tenor_months  numeric(6,2) not null check (tenor_months > 0),
  rate_override numeric(6,4),                 -- annual, e.g. 0.1850; NULL = scenario rate
  recall_date   date,                          -- optional early liquidation
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists placements_entity_idx on placements (entity);
create index if not exists placements_start_idx  on placements (start_date);

-- Single-row settings: yield scenario rates, WHT and early-recall penalty.
create table if not exists investment_settings (
  id        integer primary key check (id = 1),
  ngn_rate  numeric(6,4) not null default 0.18,   -- Base scenario
  usd_rate  numeric(6,4) not null default 0.07,
  ngn_wht   numeric(6,4) not null default 0.10,
  usd_wht   numeric(6,4) not null default 0,
  penalty   numeric(6,4) not null default 0,
  updated_at timestamptz not null default now()
);
insert into investment_settings (id) values (1) on conflict (id) do nothing;
