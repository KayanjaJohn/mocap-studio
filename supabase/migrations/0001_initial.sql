-- MoCap Studio initial data model. Run in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.mocap_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled capture project',
  description text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mocap_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.mocap_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_type text not null check (asset_type in ('source_video','avatar','reference_image','render')),
  storage_path text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.mocap_takes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.mocap_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Motion take',
  source_asset_id uuid references public.mocap_assets(id) on delete set null,
  motion_data_path text,
  duration_ms bigint,
  frame_count bigint not null default 0,
  capture_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mocap_projects_owner_created_idx on public.mocap_projects(owner_id, created_at desc);
create index if not exists mocap_assets_project_idx on public.mocap_assets(project_id, created_at desc);
create index if not exists mocap_takes_project_idx on public.mocap_takes(project_id, created_at desc);

alter table public.mocap_projects enable row level security;
alter table public.mocap_assets enable row level security;
alter table public.mocap_takes enable row level security;

create policy "Owners manage their projects"
  on public.mocap_projects for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners manage their assets"
  on public.mocap_assets for all
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id and exists (
      select 1 from public.mocap_projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

create policy "Owners manage their takes"
  on public.mocap_takes for all
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id and exists (
      select 1 from public.mocap_projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_mocap_projects_updated_at on public.mocap_projects;
create trigger set_mocap_projects_updated_at
before update on public.mocap_projects
for each row execute function public.set_updated_at();
