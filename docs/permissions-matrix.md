# Permissions matrix

Source of truth in code: `api/_lib/permissions.ts` (UI) and RLS/functions in the migrations (enforcement). The UI check is only convenience.

| Capability | Owner | Admin | Manager | Employee | Client portal user |
|---|---|---|---|---|---|
| Org settings, roles, invites | ✔ | ✔ (not owners) | – | – | – |
| Clients / contacts / notes: read | ✔ | ✔ | ✔ | ✔ (read) | own client only |
| Clients / contacts / notes: write | ✔ | ✔ | ✔ | – | – |
| Projects / milestones: write | ✔ | ✔ | ✔ | – | – |
| Tasks: create/edit/assign/archive/dependencies | ✔ | ✔ | ✔ | – | request via portal only |
| Task status change | ✔ | ✔ | ✔ | assigned tasks only | – |
| Comments (internal) | ✔ | ✔ | ✔ | ✔ | never visible |
| Comments (client-visible) | ✔ | ✔ | ✔ | ✔ | on shared tasks |
| Raise escalation | ✔ | ✔ | ✔ | ✔ | – |
| Update/resolve escalation | ✔ | ✔ | ✔ | if owner | never visible |
| Reports, activity logs, employees page | ✔ | ✔ | ✔ | – | – |
| Approve deliverable | assigned approver | | | | contacts with `can_approve` |

Known simplifications: any org member can *read* all org tasks/clients (no per-team read scoping); the dependency-override is available to all managers (not configurable per org).
