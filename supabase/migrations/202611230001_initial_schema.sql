-- Elixir Cyber Security Learning Community
-- Run with the Supabase CLI (`supabase db push`) or paste into the SQL editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('student', 'instructor', 'admin');
create type public.content_status as enum ('draft', 'published', 'archived');
create type public.submission_status as enum ('draft', 'submitted', 'reviewed', 'returned');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_url text,
  role public.user_role not null default 'student',
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  cover_image_url text,
  instructor_id uuid references public.profiles(id) on delete set null,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_number integer not null check (lesson_number > 0),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  content text not null default '',
  video_url text,
  status public.content_status not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, lesson_number),
  unique (course_id, sort_order)
);

create table public.course_enrollments (
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  last_lesson_id uuid references public.lessons(id) on delete set null,
  last_viewed_at timestamptz,
  primary key (course_id, user_id)
);

create table public.lesson_attachments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 26214400),
  created_at timestamptz not null default now()
);

create table public.lesson_progress (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed boolean not null default false,
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (lesson_id, user_id),
  check ((completed and completed_at is not null) or (not completed))
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 3000),
  media_url text,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 26214400),
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction = 'like'),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 1 and 3000),
  is_pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  due_at timestamptz,
  attachment_path text,
  status public.content_status not null default 'draft',
  counts_toward_selection_exam boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  attachment_path text,
  status public.submission_status not null default 'draft',
  submitted_at timestamptz,
  feedback text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('comment', 'reaction', 'announcement', 'assignment', 'feedback')),
  title text not null,
  body text not null default '',
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index posts_created_at_idx on public.posts (created_at desc) where not is_hidden;
create index post_attachments_post_idx on public.post_attachments (post_id);
create index comments_post_created_idx on public.comments (post_id, created_at) where not is_hidden;
create index reactions_post_idx on public.post_reactions (post_id);
create index lessons_course_order_idx on public.lessons (course_id, sort_order);
create index progress_user_idx on public.lesson_progress (user_id, completed);
create index enrollments_user_idx on public.course_enrollments (user_id);
create index assignments_course_due_idx on public.assignments (course_id, due_at);
create index submissions_assignment_idx on public.assignment_submissions (assignment_id, submitted_at desc);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','courses','lessons','lesson_progress','posts','comments','announcements','assignments','assignment_submissions']
  loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.is_educator(user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = user_id and role in ('instructor','admin') and is_active);
$$;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = user_id and role = 'admin' and is_active);
$$;

create or replace function public.can_manage_course(course uuid, user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin(user_id) or (public.is_educator(user_id) and exists(
    select 1 from public.courses where id = course and instructor_id = user_id
  ));
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare base_username text;
begin
  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'student'), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(base_username) < 3 then base_username := 'student'; end if;
  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Student'), 80),
    left(base_username, 21) || '_' || substr(replace(new.id::text, '-', ''), 1, 8)
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Keep role, activation state, and join date immutable to ordinary profile updates.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Preserve privileged fields for ordinary authenticated users. A null
  -- auth.uid() represents trusted server-side maintenance (for example the
  -- Supabase SQL editor used to appoint the first administrator).
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    new.role := old.role;
    new.is_active := old.is_active;
    new.joined_at := old.joined_at;
  end if;
  return new;
end;
$$;
create trigger protect_profile_privileges before update on public.profiles
for each row execute function public.protect_profile_privileges();

-- Students can edit their submission, but cannot manufacture review data.
create or replace function public.protect_submission_review()
returns trigger language plpgsql set search_path = '' as $$
declare managed boolean;
begin
  select public.can_manage_course(a.course_id) into managed
  from public.assignments a where a.id = new.assignment_id;
  if not coalesce(managed, false) then
    if tg_op = 'INSERT' then
      new.feedback := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      if new.status not in ('draft', 'submitted') then new.status := 'draft'; end if;
    else
      new.assignment_id := old.assignment_id;
      new.student_id := old.student_id;
      new.feedback := old.feedback;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      if new.status not in ('draft', 'submitted') then new.status := old.status; end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger protect_submission_review before insert or update on public.assignment_submissions
for each row execute function public.protect_submission_review();

create or replace function public.protect_moderation_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_admin(auth.uid()) then new.is_hidden := old.is_hidden; end if;
  return new;
end;
$$;
create trigger protect_post_moderation before update on public.posts for each row execute function public.protect_moderation_fields();
create trigger protect_comment_moderation before update on public.comments for each row execute function public.protect_moderation_fields();

create or replace function public.protect_content_relationships()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'courses' and not public.is_admin(auth.uid()) then
    new.instructor_id := old.instructor_id;
  elsif tg_table_name in ('lessons', 'assignments') then
    new.course_id := old.course_id;
  elsif tg_table_name = 'course_enrollments' then
    new.course_id := old.course_id;
    new.user_id := old.user_id;
  elsif tg_table_name = 'lesson_progress' then
    new.lesson_id := old.lesson_id;
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;
create trigger protect_course_instructor before update on public.courses for each row execute function public.protect_content_relationships();
create trigger protect_lesson_course before update on public.lessons for each row execute function public.protect_content_relationships();
create trigger protect_assignment_course before update on public.assignments for each row execute function public.protect_content_relationships();
create trigger protect_enrollment_keys before update on public.course_enrollments for each row execute function public.protect_content_relationships();
create trigger protect_progress_keys before update on public.lesson_progress for each row execute function public.protect_content_relationships();

create or replace function public.protect_notification_content()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_admin(auth.uid()) then
    new.user_id := old.user_id;
    new.actor_id := old.actor_id;
    new.kind := old.kind;
    new.title := old.title;
    new.body := old.body;
    new.href := old.href;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger protect_notification_content before update on public.notifications
for each row execute function public.protect_notification_content();

-- Bootcamp work in the first fourteen days is always kept separate from selection scoring.
create or replace function public.protect_early_assignment_score()
returns trigger language plpgsql set search_path = '' as $$
declare course_start timestamptz;
begin
  select created_at into course_start from public.courses where id = new.course_id;
  if coalesce(new.due_at, new.created_at, now()) < course_start + interval '14 days' then
    new.counts_toward_selection_exam := false;
  end if;
  return new;
end;
$$;
create trigger protect_early_assignment_score before insert or update on public.assignments
for each row execute function public.protect_early_assignment_score();

-- Simple database-enforced abuse limits; client-side checks are not trusted.
create or replace function public.enforce_social_rate_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recent_count integer;
begin
  if tg_table_name = 'posts' then
    select count(*) into recent_count from public.posts where author_id = new.author_id and created_at > now() - interval '1 minute';
    if recent_count >= 5 then raise exception 'Post rate limit exceeded'; end if;
  else
    select count(*) into recent_count from public.comments where author_id = new.author_id and created_at > now() - interval '1 minute';
    if recent_count >= 15 then raise exception 'Comment rate limit exceeded'; end if;
  end if;
  return new;
end;
$$;
create trigger rate_limit_posts before insert on public.posts for each row execute function public.enforce_social_rate_limit();
create trigger rate_limit_comments before insert on public.comments for each row execute function public.enforce_social_rate_limit();

-- Activity notifications are generated in the database so clients cannot spoof actors.
create or replace function public.notify_post_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
declare actor_name text;
begin
  select display_name into actor_name from public.profiles where id = new.author_id;
  select author_id into recipient from public.posts where id = new.post_id;
  if recipient is distinct from new.author_id then
    insert into public.notifications (user_id, actor_id, kind, title, body, href)
    values (recipient, new.author_id, 'comment', actor_name || ' commented on your post', left(new.body, 160), '#/feed');
  end if;
  return new;
end;
$$;
create trigger notify_new_comment after insert on public.comments for each row execute function public.notify_post_activity();

create or replace function public.notify_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
declare actor_name text;
begin
  select display_name into actor_name from public.profiles where id = new.user_id;
  select author_id into recipient from public.posts where id = new.post_id;
  if recipient is distinct from new.user_id then
    insert into public.notifications (user_id, actor_id, kind, title, href)
    values (recipient, new.user_id, 'reaction', actor_name || ' liked your post', '#/feed');
  end if;
  return new;
end;
$$;
create trigger notify_new_reaction after insert on public.post_reactions for each row execute function public.notify_reaction();

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
create trigger notify_new_announcement after insert on public.announcements for each row execute function public.notify_learning_content();
create trigger notify_new_assignment after insert on public.assignments for each row when (new.status = 'published') execute function public.notify_learning_content();
create trigger notify_published_assignment after update on public.assignments for each row when (old.status <> 'published' and new.status = 'published') execute function public.notify_learning_content();

create or replace function public.notify_submission_feedback()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assignment_title text;
begin
  if new.feedback is distinct from old.feedback and new.feedback is not null then
    select title into assignment_title from public.assignments where id = new.assignment_id;
    insert into public.notifications (user_id, actor_id, kind, title, body, href)
    values (new.student_id, new.reviewed_by, 'feedback', 'Feedback: ' || assignment_title, left(new.feedback, 160), '#/assignments');
  end if;
  return new;
end;
$$;
create trigger notify_feedback after update on public.assignment_submissions for each row execute function public.notify_submission_feedback();

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_attachments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.posts enable row level security;
alter table public.post_attachments enable row level security;
alter table public.comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.announcements enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.notifications enable row level security;

create policy "authenticated users view profiles" on public.profiles for select to authenticated using (is_active or id = auth.uid() or public.is_admin());
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy "members view published courses" on public.courses for select to authenticated using (status = 'published' or public.can_manage_course(id));
create policy "educators create courses" on public.courses for insert to authenticated with check (public.is_admin() or (public.is_educator() and instructor_id = auth.uid()));
create policy "course managers update courses" on public.courses for update to authenticated using (public.can_manage_course(id)) with check (public.can_manage_course(id));
create policy "admins delete courses" on public.courses for delete to authenticated using (public.is_admin());

create policy "users view own enrollment" on public.course_enrollments for select to authenticated using (user_id = auth.uid() or public.can_manage_course(course_id));
create policy "students enroll in published courses" on public.course_enrollments for insert to authenticated with check (user_id = auth.uid() and exists(select 1 from public.courses c where c.id = course_id and c.status = 'published'));
create policy "users update own enrollment" on public.course_enrollments for update to authenticated using (user_id = auth.uid() or public.can_manage_course(course_id)) with check (user_id = auth.uid() or public.can_manage_course(course_id));
create policy "users leave own course" on public.course_enrollments for delete to authenticated using (user_id = auth.uid() or public.can_manage_course(course_id));

create policy "members view available lessons" on public.lessons for select to authenticated using (
  public.can_manage_course(course_id) or (status = 'published' and exists(select 1 from public.course_enrollments e where e.course_id = lessons.course_id and e.user_id = auth.uid()))
);
create policy "course managers create lessons" on public.lessons for insert to authenticated with check (public.can_manage_course(course_id));
create policy "course managers update lessons" on public.lessons for update to authenticated using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));
create policy "course managers delete lessons" on public.lessons for delete to authenticated using (public.can_manage_course(course_id));

create policy "members view lesson attachments" on public.lesson_attachments for select to authenticated using (exists(
  select 1 from public.lessons l where l.id = lesson_id and (
    public.can_manage_course(l.course_id) or (l.status = 'published' and exists(select 1 from public.course_enrollments e where e.course_id = l.course_id and e.user_id = auth.uid()))
  )
));
create policy "course managers create attachments" on public.lesson_attachments for insert to authenticated with check (exists(select 1 from public.lessons l where l.id = lesson_id and public.can_manage_course(l.course_id)));
create policy "course managers delete attachments" on public.lesson_attachments for delete to authenticated using (exists(select 1 from public.lessons l where l.id = lesson_id and public.can_manage_course(l.course_id)));

create policy "users view own progress" on public.lesson_progress for select to authenticated using (user_id = auth.uid() or exists(select 1 from public.lessons l where l.id = lesson_id and public.can_manage_course(l.course_id)));
create policy "users create own progress" on public.lesson_progress for insert to authenticated with check (user_id = auth.uid() and exists(select 1 from public.lessons l join public.course_enrollments e on e.course_id = l.course_id where l.id = lesson_id and e.user_id = auth.uid()));
create policy "users update own progress" on public.lesson_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members view visible posts" on public.posts for select to authenticated using (not is_hidden or author_id = auth.uid() or public.is_admin());
create policy "active members create posts" on public.posts for insert to authenticated with check (author_id = auth.uid() and exists(select 1 from public.profiles where id = auth.uid() and is_active));
create policy "authors update posts" on public.posts for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy "authors delete posts" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "members view post attachments" on public.post_attachments for select to authenticated using (exists(
  select 1 from public.posts p where p.id = post_id and (not p.is_hidden or p.author_id = auth.uid() or public.is_admin())
));
create policy "educators attach post materials" on public.post_attachments for insert to authenticated with check (public.is_educator() and exists(
  select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
));
create policy "post authors delete attachments" on public.post_attachments for delete to authenticated using (exists(
  select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.is_admin())
));

create policy "members view visible comments" on public.comments for select to authenticated using (not is_hidden or author_id = auth.uid() or public.is_admin());
create policy "active members create comments" on public.comments for insert to authenticated with check (author_id = auth.uid() and exists(select 1 from public.profiles where id = auth.uid() and is_active));
create policy "authors update comments" on public.comments for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy "authors delete comments" on public.comments for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "members view reactions" on public.post_reactions for select to authenticated using (true);
create policy "members add own reaction" on public.post_reactions for insert to authenticated with check (user_id = auth.uid());
create policy "members remove own reaction" on public.post_reactions for delete to authenticated using (user_id = auth.uid());

create policy "members view relevant announcements" on public.announcements for select to authenticated using (course_id is null or public.can_manage_course(course_id) or exists(select 1 from public.course_enrollments e where e.course_id = announcements.course_id and e.user_id = auth.uid()));
create policy "educators create announcements" on public.announcements for insert to authenticated with check (author_id = auth.uid() and public.is_educator() and (course_id is null or public.can_manage_course(course_id)));
create policy "announcement authors update" on public.announcements for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy "announcement authors delete" on public.announcements for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "members view relevant assignments" on public.assignments for select to authenticated using (public.can_manage_course(course_id) or (status = 'published' and exists(select 1 from public.course_enrollments e where e.course_id = assignments.course_id and e.user_id = auth.uid())));
create policy "course managers create assignments" on public.assignments for insert to authenticated with check (created_by = auth.uid() and public.can_manage_course(course_id));
create policy "course managers update assignments" on public.assignments for update to authenticated using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));
create policy "course managers delete assignments" on public.assignments for delete to authenticated using (public.can_manage_course(course_id));

create policy "students and educators view submissions" on public.assignment_submissions for select to authenticated using (student_id = auth.uid() or exists(select 1 from public.assignments a where a.id = assignment_id and public.can_manage_course(a.course_id)));
create policy "students create own submissions" on public.assignment_submissions for insert to authenticated with check (student_id = auth.uid() and exists(select 1 from public.assignments a join public.course_enrollments e on e.course_id = a.course_id where a.id = assignment_id and a.status = 'published' and e.user_id = auth.uid()));
create policy "students or educators update submissions" on public.assignment_submissions for update to authenticated using (student_id = auth.uid() or exists(select 1 from public.assignments a where a.id = assignment_id and public.can_manage_course(a.course_id))) with check (student_id = auth.uid() or exists(select 1 from public.assignments a where a.id = assignment_id and public.can_manage_course(a.course_id)));
create policy "students delete draft submissions" on public.assignment_submissions for delete to authenticated using (student_id = auth.uid() and status = 'draft');

create policy "users view own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "users mark own notifications read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins manage notifications" on public.notifications for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant execute on function public.is_educator(uuid), public.is_admin(uuid), public.can_manage_course(uuid, uuid) to authenticated;

alter publication supabase_realtime add table public.posts, public.comments, public.post_reactions;

-- Storage: avatars and post-media are public; learning and assignment files are private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('post-media', 'post-media', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif']),
  ('post-materials', 'post-materials', false, 26214400, array['application/pdf','text/html','text/plain','application/zip','application/x-zip-compressed','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('lesson-materials', 'lesson-materials', false, 26214400, array['application/pdf','text/html','text/plain','application/zip','application/x-zip-compressed','image/jpeg','image/png','image/webp']),
  ('assignment-files', 'assignment-files', false, 26214400, array['application/pdf','text/plain','application/zip','application/x-zip-compressed','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy "users upload own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and owner_id = auth.uid()::text) with check (bucket_id = 'avatars' and owner_id = auth.uid()::text);
create policy "users delete own avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and owner_id = auth.uid()::text);
create policy "users upload own post media" on storage.objects for insert to authenticated with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own post media" on storage.objects for delete to authenticated using (bucket_id = 'post-media' and owner_id = auth.uid()::text);

create policy "members download post materials" on storage.objects for select to authenticated using (
  bucket_id = 'post-materials' and exists(
    select 1 from public.post_attachments pa join public.posts p on p.id = pa.post_id
    where pa.storage_path = name and (not p.is_hidden or p.author_id = auth.uid() or public.is_admin())
  )
);
create policy "educators upload post materials" on storage.objects for insert to authenticated with check (
  bucket_id = 'post-materials' and public.is_educator() and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "post material owners delete" on storage.objects for delete to authenticated using (
  bucket_id = 'post-materials' and (owner_id = auth.uid()::text or public.is_admin())
);

create policy "members download authorized lesson material" on storage.objects for select to authenticated using (
  bucket_id = 'lesson-materials' and exists(
    select 1 from public.lesson_attachments la join public.lessons l on l.id = la.lesson_id
    where la.storage_path = name and (public.can_manage_course(l.course_id) or exists(select 1 from public.course_enrollments e where e.course_id = l.course_id and e.user_id = auth.uid()))
  )
);
create policy "course managers upload lesson material" on storage.objects for insert to authenticated with check (
  bucket_id = 'lesson-materials' and public.can_manage_course(((storage.foldername(name))[1])::uuid)
);
create policy "course managers delete lesson material" on storage.objects for delete to authenticated using (
  bucket_id = 'lesson-materials' and public.can_manage_course(((storage.foldername(name))[1])::uuid)
);

create policy "students and course educators access assignment files" on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and (
    owner_id = auth.uid()::text
    or exists(
      select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id
      where s.attachment_path = name and public.can_manage_course(a.course_id)
    )
    or exists(
      select 1 from public.assignments a where a.attachment_path = name and (
        public.can_manage_course(a.course_id)
        or exists(select 1 from public.course_enrollments ce where ce.course_id = a.course_id and ce.user_id = auth.uid())
      )
    )
  )
);
create policy "members upload own assignment files" on storage.objects for insert to authenticated with check (
  bucket_id = 'assignment-files' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "owners or course managers delete assignment files" on storage.objects for delete to authenticated using (
  bucket_id = 'assignment-files' and (
    owner_id = auth.uid()::text
    or exists(select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id where s.attachment_path = name and public.can_manage_course(a.course_id))
  )
);
