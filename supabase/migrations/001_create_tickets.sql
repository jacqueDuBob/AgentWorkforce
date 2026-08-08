create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Urgent')),
  tags text[] not null default '{}' check (cardinality(tags) <= 3),
  assignee text not null default '',
  acceptance_criteria text not null default '',
  status text not null default 'New' check (status in ('New','In Refinement','Ready','In Work','Work Completed','In Review','Review Completed','In Testing','Testing Completed','Ready for Live','Live')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tickets enable row level security;

-- Enable Anonymous Sign-Ins in Supabase Auth. Users get an isolated identity without a login screen.
create policy "Users can read their own tickets" on public.tickets for select to authenticated using (auth.uid() = user_id);
create policy "Users can create their own tickets" on public.tickets for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own tickets" on public.tickets for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own tickets" on public.tickets for delete to authenticated using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_set_updated_at before update on public.tickets
for each row execute function public.set_updated_at();

create index if not exists tickets_user_status_position_idx on public.tickets (user_id, status, position);
