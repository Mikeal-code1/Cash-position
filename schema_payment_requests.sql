-- schema_payment_requests.sql — adds payment-request tracking.
-- Run ONCE in your Supabase SQL Editor (after schema.sql and seed.sql).
-- Does not modify any existing tables.

create type request_status as enum ('pending', 'matched', 'cancelled');

create table payment_requests (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  request_date    date not null,
  description     text not null,
  amount          numeric(20,2) not null check (amount >= 0),
  currency        char(3) not null,
  bank            text,                       -- destination bank, from the file
  beneficiary     text,                       -- beneficiary account name
  status          request_status not null default 'pending',
  matched_txn_id  uuid references transactions(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Idempotent re-import: the same (account, date, amount, description) is the same request.
create unique index payment_requests_dedup_key
  on payment_requests (account_id, request_date, amount, description);

create index on payment_requests (account_id, status);
create index on payment_requests (account_id, request_date);
