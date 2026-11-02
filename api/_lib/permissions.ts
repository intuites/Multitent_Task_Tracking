export type Role =
  | 'platform_admin' | 'owner' | 'admin' | 'employee' | 'client_user';

export type Action =
  | 'org:manage' | 'members:manage' | 'client:write' | 'client:read'
  | 'project:write' | 'project:read' | 'task:write' | 'task:read'
  | 'task:status' | 'escalation:manage' | 'report:read' | 'activity:read'
  | 'internal_comment:read';

const ALL: Action[] = [
  'org:manage', 'members:manage', 'client:write', 'client:read', 'project:write',
  'project:read', 'task:write', 'task:read', 'task:status', 'escalation:manage',
  'report:read', 'activity:read', 'internal_comment:read',
];

export const MATRIX: Record<Role, Action[]> = {
  platform_admin: [],
  owner: ALL,
  // organizations have two roles, admin and employee; 'owner' is how a platform admin acts inside any organization
  admin: ALL,
  employee: ['client:read', 'project:read', 'task:read', 'task:status', 'internal_comment:read'],
  client_user: [], // portal access is checked per-record, never via this matrix
};

/** Role must come from a verified org_members row, never from the request. */
export const can = (role: Role | undefined, action: Action): boolean =>
  // an unknown role (e.g. a leftover 'manager' before migration 0023 runs) gets no permissions instead of crashing
  !!role && (MATRIX[role] ?? []).includes(action);
