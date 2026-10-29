import {
  BarChart3, Bell, BookOpen, CopyPlus, Building2, CalendarDays, ClipboardList, Contact, FolderKanban, History, LayoutDashboard,
  ListTodo, Settings, Siren, UserCircle, Users, UsersRound, type LucideIcon,
} from 'lucide-react';
import { can, type Action, type Role } from '../../api/_lib/permissions';

export interface NavItem { path: string; label: string; icon: LucideIcon; group: string; needs?: Action }

export const NAV: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Menu' },
  { path: '/my-tasks', label: 'My Tasks', icon: ListTodo, group: 'Menu', needs: 'task:read' },
  { path: '/tasks', label: 'Tasks', icon: ClipboardList, group: 'Menu', needs: 'task:read' },
  { path: '/team-tasks', label: 'Team Tasks', icon: UsersRound, group: 'Menu', needs: 'task:read' },
  { path: '/templates', label: 'Task Templates', icon: CopyPlus, group: 'Menu', needs: 'task:write' },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays, group: 'Menu', needs: 'task:read' },
  { path: '/escalations', label: 'Escalations', icon: Siren, group: 'Menu', needs: 'task:read' },
  { path: '/clients', label: 'CRM / Clients', icon: Building2, group: 'CRM', needs: 'client:write' },
  { path: '/contacts', label: 'Contacts', icon: Contact, group: 'CRM', needs: 'client:write' },
  { path: '/projects', label: 'Projects', icon: FolderKanban, group: 'CRM', needs: 'project:read' },
  { path: '/employees', label: 'Employees & Teams', icon: Users, group: 'Team', needs: 'task:write' },
  { path: '/reports', label: 'Reports', icon: BarChart3, group: 'Team', needs: 'report:read' },
  { path: '/activity', label: 'Activity Logs', icon: History, group: 'Team', needs: 'task:write' },
  { path: '/notifications', label: 'Notifications', icon: Bell, group: 'General' },
  { path: '/settings', label: 'Organization Settings', icon: Settings, group: 'General' },
  { path: '/profile', label: 'My Profile', icon: UserCircle, group: 'General' },
  { path: '/guide', label: 'Guide', icon: BookOpen, group: 'General' },
];

export const navFor = (role: Role | undefined) => NAV.filter((n) => !n.needs || can(role, n.needs));
