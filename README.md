# Elixir

Elixir is a social-first Cyber Security Bootcamp community. It preserves the
original Elixir feed design while adding Supabase authentication, social
features, courses, lessons, private materials, progress, assignments,
notifications, and an educator/admin workspace.

The original repository audit is in [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md).

## Local setup

Requirements: Node.js 22+, npm, and a Supabase project.

1. Install dependencies: `npm install`.
2. Create a Supabase project.
3. Run `supabase/migrations/202611230001_initial_schema.sql` in the Supabase SQL
   Editor. If using the Supabase CLI, link the project and run
   `supabase db push`.
4. Copy `.env.example` to `.env` and add the project URL and anon key from
   **Project Settings → API**. Never use the service-role key in a `VITE_`
   variable.
5. In **Authentication → URL Configuration**, set Site URL to the local URL
   while developing (normally `http://localhost:5173`) and add that URL to the
   redirect allow list.
6. Run `npm run dev`.

Email confirmation is supported. For quick local testing, it can temporarily
be disabled in Supabase Authentication provider settings.

## Create the first admin

There are deliberately no public admin credentials and registration cannot
self-assign a role.

1. Register normally in Elixir.
2. In the Supabase SQL Editor, run the following while replacing the email:

   ```sql
   update public.profiles p
   set role = 'admin'
   from auth.users u
   where p.id = u.id and u.email = 'OWNER_EMAIL@example.com';
   ```

3. Log out and back in. The Admin navigation item will appear.

To create sample course content, replace the placeholder UUID in
`supabase/seed.sql` with this profile ID, then run the file. All seed content is
explicitly sample content and contains no student records.

## Netlify deployment

1. Push this repository to GitHub and import it in Netlify.
2. Netlify reads `netlify.toml`: build command `npm run build`, publish directory
   `dist`, Node 22, SPA fallback, caching, and security headers are configured.
   The equivalent `public/_headers` and `public/_redirects` files ensure the
   same protections when the production bundle is deployed with Netlify Drop.
3. In **Site configuration → Environment variables**, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy the site.
5. Copy the final HTTPS Netlify URL. In Supabase **Authentication → URL
   Configuration**, set it as Site URL and add both the production URL and any
   Netlify deploy-preview pattern you intend to use to Redirect URLs.

No Netlify Function is currently necessary: all implemented operations are
user-scoped and authorized by Supabase RLS. Add a function only for future
work that genuinely requires a secret or privileged operation; it must verify
the caller JWT and role before using a service key.

## Storage and video

- `avatars` and `post-media` are public image buckets with MIME and size limits.
- Educator/admin posts can combine text, one feed image, and multiple private
  downloadable materials from `post-materials`.
- `lesson-materials` and `assignment-files` are private. Downloads use signed
  URLs valid for 60 seconds.
- Lesson material uploads accept PDF, HTML, TXT, ZIP, JPEG, PNG, and WebP up to
  25 MB. HTML is downloaded, never rendered in the authenticated app origin.
- Lessons accept YouTube links (embedded with the privacy-enhanced domain) and
  external video URLs (opened as external links). Large videos are not stored
  in the repository or Supabase Storage.

## Commands and verification

- `npm run dev` — local development server
- `npm run check` — ESLint static checks
- `npm run build` — Netlify production bundle
- `npm run preview` — preview the production bundle

Database and RLS integration tests require a live Supabase project. Before
production enrollment, test with separate student, instructor, and admin
accounts and verify denied cross-account updates, private signed downloads,
deactivation, submission review, and mobile layouts.

## Current limitations

- Direct messaging and the unused AI chat styles from the original prototype
  are not implemented because the brief prioritizes the community and learning
  system.
- Realtime refresh covers social tables. Other screens refresh on navigation.
- Video view analytics are represented by lesson opens (`lesson_progress`), not
  third-party player completion telemetry.
- Supabase email delivery, project creation, production migration execution,
  and Netlify deployment require the project owner's accounts and credentials.
