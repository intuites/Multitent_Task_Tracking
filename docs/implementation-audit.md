# Implementation Audit (Phase 0)

**Status: audit of the existing system NOT possible.** The project folder was empty at start: no repo, no Candidate Dashboard source, no migrations. The owner's Supabase lives in a separate account not reachable from this tooling, so no live schema was inspected. The app was therefore built greenfield, locally; no deployment, no git push (per owner's instruction).

## Needed from the owner before production use
1. Existing repo / Candidate Dashboard source.
2. Schema dump: `supabase db dump --schema public -f schema.sql` (no data).
3. Names of existing organization / employee / user tables, so migrations can reuse them instead of creating `organizations`, `org_members`, `clients`, `projects`, `client_contacts`.

## Decisions
- Vite + React + TS; Vercel-style handlers in `api/`; Supabase for DB/Auth/Storage.
- Migrations `0001`–`0005` use `create … if not exists` / `add column if not exists` only. Nothing is dropped or altered destructively. Policies are created without `if not exists`; re-running a migration will error on duplicate policy names (safe, but apply once).
- New helper tables are `tt_`-prefixed to avoid collisions (`tt_profiles`). Un-prefixed core names (`organizations`, `clients`, `projects`, `org_members`, `client_contacts`, `client_notes`) **may collide** with existing tables — if they exist with different columns the migration will not reconcile them.
- Candidate Dashboard: placeholder route only. No regression testing possible.
- No subscription / billing features.

## Risks
- RLS and SQL functions have been written but **never executed against a database** (see `testing.md`).
- Trigger on `auth.users` (`tt_on_auth_user_created`) requires running migration 0004 with sufficient privileges (SQL editor works).
