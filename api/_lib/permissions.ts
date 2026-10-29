export type Role =
  | 'platform_admin' | 'owner' | 'admin' | 'manager' | 'employee' | 'client_user';

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
  admin: ALL, // full access; only owner-role changes stay owner-only (enforced in the database)
  manager: ['client:read', 'client:write', 'project:read', 'project:write', 'task:read',
    'task:write', 'task:status', 'escalation:manage', 'report:read', 'internal_comment:read'],
  employee: ['client:read', 'project:read', 'task:read', 'task:status', 'internal_comment:read'],
  client_user: [], // portal access is checked per-record, never via this matrix
};

/** Role must come from a verified org_members row, never from the request. */
export const can = (role: Role | undefined, action: Action): boolean =>
  !!role && MATRIX[role].includes(action);
