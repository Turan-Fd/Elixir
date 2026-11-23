# Verification results

Date: 2026-11-23

## Passed locally

- `npm install`: 0 dependency vulnerabilities reported.
- `npm run check`: ESLint passes with no errors.
- `npm run build`: Vite production bundle succeeds.
- Netlify entrypoint: local development server returned HTTP 200.
- Desktop render: authentication card, original typography, black theme, border,
  rounded controls, and setup warning rendered correctly.
- Mobile render at 390 × 844: no horizontal overflow (`scrollWidth = 390`),
  wordmark remains visible, and the auth card collapses cleanly.
- Registration/login mode toggle: registration fields become visible and
  required, and the submit label changes correctly.
- Browser console: no errors or warnings on the unconfigured setup screen.
- Security review: no service-role key in browser code; HTML output is escaped;
  lesson HTML is only downloadable; external video protocols are restricted to
  HTTP(S); private files use signed URLs.

## Requires the project owner's Supabase environment

The following cannot be honestly executed without a live project URL and anon
key. A pre-production test should use separate student, instructor, and admin
accounts:

- Apply the migration and inspect all RLS/storage policy creation results.
- Confirm email signup, confirmation, password recovery, session persistence,
  deactivation, and role promotion behavior.
- Attempt forbidden cross-user profile, progress, submission, and moderation
  writes through the REST API.
- Upload every allowed and rejected file type/size; verify signed download expiry.
- Verify realtime post/comment/reaction refresh and database notifications.
- Exercise enroll → lesson open → completion → course percentage.
- Exercise assignment submission → instructor feedback and verify a student
  cannot write review fields.
- Verify early assignments cannot set `counts_toward_selection_exam = true`.
- Deploy to Netlify and repeat the responsive smoke test on the production URL.
