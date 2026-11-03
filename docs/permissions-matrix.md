# Permissions matrix

Source of truth in code: `api/_lib/permissions.ts` (UI) and RLS/functions in the migrations (enforcement). The UI check is only convenience.

Inside an organization there are two roles, admin and employee. The platform admin belongs to no organization and opens every one with admin rights (it appears as `owner` in code).

| Capability | Admin | Employee | Platform admin |
|---|---|---|---|
| Org settings, roles, invites, departments | ✔ | – | ✔ (any org) |
| Tasks: create/edit/assign/archive | ✔ | – | ✔ |
| Task status change | ✔ | assigned tasks only | ✔ |
| Comments and files on tasks | ✔ | ✔ | ✔ |
| Raise escalation | ✔ | ✔ | ✔ |
| Reports, activity log, employees page | ✔ | – | ✔ |
| Admin site (all organizations, platform admins) | – | – | ✔ |

Known simplification: any org member can *read* all org tasks (no per-department read scoping).
