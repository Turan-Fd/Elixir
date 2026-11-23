# Elixir architecture audit

## Original repository

The original `main` branch contained two files: `index.html` and
`assets/css/style.css`. It was a dependency-free static prototype, not an
application framework. The UI consisted of a Twitter-style three-column feed,
a fixed left navigation, responsive mobile bottom navigation, a post composer,
two duplicate hard-coded feed cards, search/trends/weather side cards, and an
animated Elixir loader. The stylesheet also contained unused chat/prompt rules.

No router, package manager, database client, authentication, storage, API,
tests, or deployment configuration existed. All profile data, posts, reaction
counts, trends, images, and weather content were hardcoded. The only working
JavaScript behavior was the loader delay and textarea auto-resize. The Home
link referenced a missing `home.html` file.

## Integration approach

The original HTML/CSS visual system remains the source of truth. The project
continues to use vanilla HTML, CSS, and JavaScript; Vite only provides safe
environment-variable substitution and production bundling. No component
library or replacement frontend framework was introduced.

The application is a hash-routed SPA so it works on Netlify and retains the
single-page social experience. Supabase JS handles authenticated client
operations. PostgreSQL Row Level Security is the authorization boundary.
Private lesson and assignment files use short-lived signed URLs; uploaded HTML
is downloaded and is never injected into the app origin.

## Functional map

| Existing UI | Backend integration |
| --- | --- |
| Post composer/feed cards | `posts`, Storage `post-media`, paginated queries |
| Educator mixed posts | private `post-materials`, signed downloads, multiple attachments |
| Comment/heart controls | `comments`, `post_reactions`, realtime refresh |
| Profile areas | Supabase Auth, `profiles`, Storage `avatars` |
| Notification navigation | database-generated `notifications` |
| Elixir navigation item | courses, lessons, progress, materials |
| Side community card | active profile count |
| Original responsive layout | retained at the same 1265/1024/768/500px breakpoints |

New course, assignment, notification, profile, and admin screens reuse the
original borders, black background, Poppins/Turret Road typography, blue accent,
rounded cards, fixed navigation, and responsive layout.

## Security boundaries

- Registration always creates a student profile; user metadata cannot assign a
  privileged role.
- A database trigger prevents non-admin role or activation changes even if a
  malicious client crafts a direct update.
- Course educators are scoped to courses they instruct; admins have global
  authority.
- Students can see only their own progress and submissions. Review fields are
  protected by a trigger from student tampering.
- Social ownership, moderation, course publication, enrollment, and file access
  are enforced in RLS/storage policies.
- Post and comment insertion limits are enforced by PostgreSQL triggers.
- Early bootcamp assignments are forcibly excluded from selection scoring for
  the first fourteen days of a course.
- The service-role key is not used by the frontend.
