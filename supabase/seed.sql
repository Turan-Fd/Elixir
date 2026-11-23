-- Optional SAMPLE content. Run after creating an auth user and promoting it to admin.
-- Replace the UUID below with that admin/instructor profile ID before running.
do $$
declare instructor uuid := '00000000-0000-0000-0000-000000000000';
declare course uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.profiles where id = instructor and role in ('admin','instructor')) then
    raise notice 'Seed skipped: replace the placeholder instructor UUID in supabase/seed.sql.';
    return;
  end if;

  insert into public.courses (id, title, description, instructor_id, status)
  values (course, 'Cyber Security & Ethical Hacking', 'Sample bootcamp course covering defensive security and ethical testing fundamentals.', instructor, 'published');

  insert into public.lessons (course_id, lesson_number, title, description, content, video_url, status, sort_order) values
    (course, 1, 'Introduction to Cyber Security & Ethical Hacking', 'Understand the security mindset, legal boundaries, and core disciplines.', E'## Learning objectives\n\n- Explain confidentiality, integrity, and availability.\n- Distinguish ethical testing from unauthorized access.\n- Identify common security career paths.\n\nOnly test systems when you have explicit written authorization.', null, 'published', 1),
    (course, 2, 'Linux Fundamentals', 'Build confidence with the command line, files, permissions, and processes.', E'## Learning objectives\n\n- Navigate the Linux filesystem.\n- Manage users and permissions.\n- Inspect processes and network connections.\n\nPractice in an isolated lab environment.', null, 'published', 2);
end $$;
