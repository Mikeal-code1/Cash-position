-- schema_import_log.sql — adds an audit trail of every file import.
-- Run ONCE in your Supabase SQL Editor.
-- Records the metadata of each upload (filename, size, scope, result, status,
-- and any errors). Does not modify any existing tables.

create type import_kind as enum ('bank_statement', 'payment_request');
create type import_outcome as enum ('success', 'failed', 'partial');

create table import_runs (
  id                  uuid primary key default gen_random_uuid(),
  kind                import_kind not null,
  original_filename   text not null,
  file_size_bytes     integer,

  -- Scope (filled where relevant):
  account_id          uuid references accounts(id),
  period_id           uuid references periods(id),

  -- Statement detail:
  statement_start     date,
  statement_end       date,
  opening_balance     numeric(20,2),
  closing_balance     numeric(20,2),
  txn_count           integer,

  -- Payment request detail:
  pr_inserted         integer,
  pr_duplicates       integer,
  pr_matched          integer,
  pr_unmapped_codes   text,

  outcome             import_outcome not null default 'success',
  error_message       text,
  notes               text,
  created_at          timestamptz not null default now()
);

create index on import_runs (created_at desc);
create index on import_runs (kind, created_at desc);
create index on import_runs (account_id);
