-- Community groups, targeted posts, and group assignments.
create table public.community_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 500),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.community_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.post_groups (
  post_id uuid not null references public.posts(id) on delete cascade,
  group_id uuid not null references public.community_groups(id) on delete cascade,
  primary key (post_id, group_id)
);

alter table public.assignments add column group_id uuid references public.community_groups(id) on delete set null;
alter table public.posts add column post_kind text not null default 'post' check (post_kind in ('post', 'help'));
create index group_members_user_idx on public.group_members (user_id, group_id);
create index post_groups_group_idx on public.post_groups (group_id, post_id);
create index assignments_group_due_idx on public.assignments (group_id, due_at);

create or replace function public.is_group_member(requested_group uuid, requested_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.group_members where group_id = requested_group and user_id = requested_user);
$$;

create or replace function public.can_view_post(requested_post uuid, requested_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.posts p where p.id = requested_post and (p.author_id = requested_user or public.is_admin(requested_user)))
  or not exists(select 1 from public.post_groups where post_id = requested_post)
  or exists(select 1 from public.post_groups pg join public.group_members gm on gm.group_id = pg.group_id where pg.post_id = requested_post and gm.user_id = requested_user);
$$;

create or replace function public.create_post_with_groups(post_body text, post_media_url text default null, target_group_ids uuid[] default '{}', requested_kind text default 'post')
returns uuid language plpgsql security definer set search_path = '' as $$
declare created_post uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if cardinality(target_group_ids) > 0 and not public.is_educator(auth.uid()) then
    raise exception 'Only educators can target posts to groups';
  end if;
  if requested_kind not in ('post', 'help') then raise exception 'Invalid post kind'; end if;
  insert into public.posts (author_id, body, media_url, post_kind)
  values (auth.uid(), post_body, post_media_url, requested_kind) returning id into created_post;
  insert into public.post_groups (post_id, group_id)
  select distinct created_post, group_id from unnest(coalesce(target_group_ids, '{}')) as group_id;
  return created_post;
end;
$$;

create or replace function public.notify_learning_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'announcements' then
    insert into public.notifications (user_id, actor_id, kind, title, body, href)
    select p.id, new.author_id, 'announcement', new.title, left(new.body, 160), '#/feed'
    from public.profiles p
    where p.is_active and p.id <> new.author_id and (
      new.course_id is null or exists(select 1 from public.course_enrollments e where e.course_id = new.course_id and e.user_id = p.id)
    );
  elsif new.group_id is not null then
    insert into public.notifications (user_id, actor_id, kind, title, body, href)
    select gm.user_id, new.created_by, 'assignment', 'New group assignment: ' || new.title,
      case when new.due_at is null then 'A new assignment was published.' else 'Check the assignment page for its due date.' end,
      '#/assignments'
    from public.group_members gm join public.profiles p on p.id = gm.user_id
    where gm.group_id = new.group_id and p.is_active and gm.user_id <> new.created_by;
  else
    insert into public.notifications (user_id, actor_id, kind, title, body, href)
    select e.user_id, new.created_by, 'assignment', 'New assignment: ' || new.title,
      case when new.due_at is null then 'A new assignment was published.' else 'Check the assignment page for its due date.' end,
      '#/assignments'
    from public.course_enrollments e where e.course_id = new.course_id;
  end if;
  return new;
end;
$$;

alter table public.community_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.post_groups enable row level security;

create policy "members view their groups" on public.community_groups for select to authenticated using (public.is_admin() or public.is_group_member(id));
create policy "admins create groups" on public.community_groups for insert to authenticated with check (public.is_admin() and created_by = auth.uid());
create policy "admins update groups" on public.community_groups for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete groups" on public.community_groups for delete to authenticated using (public.is_admin());

create policy "members view group memberships" on public.group_members for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admins add group members" on public.group_members for insert to authenticated with check (public.is_admin());
create policy "admins remove group members" on public.group_members for delete to authenticated using (public.is_admin());

create policy "members view visible post groups" on public.post_groups for select to authenticated using (public.can_view_post(post_id));
create policy "educators target their posts" on public.post_groups for insert to authenticated with check (public.is_educator() and exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
create policy "authors remove post targets" on public.post_groups for delete to authenticated using (exists(select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.is_admin())));

drop policy "members view visible posts" on public.posts;
create policy "members view visible group posts" on public.posts for select to authenticated using ((not is_hidden and public.can_view_post(id)) or author_id = auth.uid() or public.is_admin());

drop policy "members view post attachments" on public.post_attachments;
create policy "members view visible post attachments" on public.post_attachments for select to authenticated using (public.can_view_post(post_id));

drop policy "members view relevant assignments" on public.assignments;
create policy "members view relevant group assignments" on public.assignments for select to authenticated using (
  public.can_manage_course(course_id)
  or (status = 'published' and ((group_id is not null and public.is_group_member(group_id)) or (group_id is null and exists(select 1 from public.course_enrollments e where e.course_id = assignments.course_id and e.user_id = auth.uid()))))
);

grant execute on function public.is_group_member(uuid, uuid), public.can_view_post(uuid, uuid), public.create_post_with_groups(text, text, uuid[], text) to authenticated;
alter publication supabase_realtime add table public.community_groups, public.group_members, public.post_groups;
