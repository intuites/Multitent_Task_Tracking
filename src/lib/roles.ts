import type { Action, Role } from '../../api/_lib/permissions';

// Plain-English names for each permission, used by the guide and the profile page.
export const ACTION_TEXT: Record<Action, string> = {
  'org:manage': 'Manage organization settings',
  'members:manage': 'Invite people and change roles',
  'client:write': 'Add and edit clients and contacts',
  'client:read': 'View clients and contacts',
  'project:write': 'Create, edit and delete projects',
  'project:read': 'View projects',
  'task:write': 'Create, assign and edit tasks',
  'task:read': 'View tasks',
  'task:status': 'Update the status of their tasks',
  'escalation:manage': 'Raise and resolve escalations',
  'report:read': 'View reports and export CSV',
  'activity:read': 'See the activity log',
  'internal_comment:read': 'Read internal comments',
};

export const ROLE_TEXT: Record<Exclude<Role, 'platform_admin' | 'client_user'>, { title: string; blurb: string }> = {
  owner: { title: 'Owner', blurb: 'Full control of the workspace, including who else is an owner.' },
  admin: { title: 'Admin', blurb: 'Full access to everything except changing owners.' },
  manager: { title: 'Manager', blurb: 'Runs the work day to day: clients, projects, tasks and escalations.' },
  employee: { title: 'Employee', blurb: 'Works on assigned tasks, updates their status and comments.' },
};
