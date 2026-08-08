create table public.workspace_settings (
  user_id uuid primary key default auth.uid(),
  master_instructions text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.workspace_settings enable row level security;

create policy "Users manage their own workspace settings"
  on public.workspace_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
