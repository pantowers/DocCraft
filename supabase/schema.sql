-- DocCraft per-account cloud backup. Never use a service-role key in the app.
create table if not exists public.doccraft_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.doccraft_folders (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.doccraft_documents enable row level security;
alter table public.doccraft_folders enable row level security;

drop policy if exists "Account owners manage their documents" on public.doccraft_documents;
create policy "Account owners manage their documents"
on public.doccraft_documents for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Account owners manage their folders" on public.doccraft_folders;
create policy "Account owners manage their folders"
on public.doccraft_folders for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.doccraft_documents to authenticated;
grant select, insert, update, delete on public.doccraft_folders to authenticated;
