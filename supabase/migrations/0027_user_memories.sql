-- Migration 0027: User cross-conversation memory
create table if not exists user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  category text not null default 'general'
    check (category in ('preference', 'bio', 'project', 'constraint', 'general')),
  content text not null,
  source_conversation_id uuid references conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_memories_user_id_updated on user_memories(user_id, updated_at desc);

-- RLS policies
alter table user_memories enable row level security;

create policy "Users can view own memories"
  on user_memories for select
  using (auth.uid() = user_id);

create policy "Users can insert own memories"
  on user_memories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own memories"
  on user_memories for update
  using (auth.uid() = user_id);

create policy "Users can delete own memories"
  on user_memories for delete
  using (auth.uid() = user_id);
