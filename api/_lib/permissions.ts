export type Role =
  | 'platform_admin' | 'owner' | 'admin' | 'employee';

export type Action =
  | 'org:manage' | 'members:manage'
  | 'project:write' | 'project:read' | 'task:write' | 'task:read'
  | 'task:status' | 'escalation:manage' | 'report:read' | 'activity:read';

const ALL: Action[] = [
  'org:manage', 'members:manage', 'project:write', 'project:read', 'task:write',
  'task:read', 'task:status', 'escalation:manage', 'report:read', 'activity:read',
];

export const MATRIX: Record<Role, Action[]> = {
  platform_admin: [],
  owner: ALL,
  // organizations have two roles, admin and employee; 'owner' is how a platform admin acts inside any organization
  admin: ALL,
  employee: ['project:read', 'task:read', 'task:status'],
};

/** Role must come from a verified org_members row, never from the request. */
export const can = (role: Role | undefined, action: Action): boolean =>
  // an unknown role (e.g. a leftover 'manager' before migration 0023 runs) gets no permissions instead of crashing
  !!role && (MATRIX[role] ?? []).includes(action);
