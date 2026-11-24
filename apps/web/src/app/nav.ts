import {
  BarChart3,
  Briefcase,
  CalendarClock,
  Coins,
  FileText,
  FileUp,
  FolderKanban,
  GanttChart,
  Layers,
  LayoutDashboard,
  Network,
  Receipt,
  Settings,
  UserCog,
  Users,
} from 'lucide-react';
import { can, canAny, type Role } from '@clientflow/contracts';

/** UI hint only: the API enforces the same matrix on every request (ADR-009). */
export function canSeeLeads(role: Role) {
  return canAny(role, ['contacts.read.all', 'contacts.read.own']);
}

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  /** Extra words the command palette matches on. */
  keywords?: string;
  visible: (role: Role) => boolean;
  /** Shows the live follow-up counter next to the label. */
  counter?: 'follow-ups';
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

// Only shipped, working sections appear. Later modules join the nav when they exist.
export const NAV: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        to: '/app/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        keywords: 'home dashboard overview',
        visible: () => true,
      },
      {
        to: '/app/follow-ups',
        label: 'Follow-ups',
        icon: CalendarClock,
        keywords: 'next steps overdue today',
        visible: canSeeLeads,
        counter: 'follow-ups',
      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales & relationships',
    items: [
      {
        to: '/app/leads',
        label: 'Leads',
        icon: Users,
        keywords: 'contacts clients customers people',
        visible: canSeeLeads,
      },
      {
        to: '/app/relationships',
        label: 'Relationship map',
        icon: Network,
        keywords: 'graph network connections',
        visible: canSeeLeads,
      },
      {
        to: '/app/deals',
        label: 'Deals',
        icon: Briefcase,
        keywords: 'deals opportunities board kanban insights',
        visible: (r) => canAny(r, ['deals.read.all', 'deals.read.own']),
      },
      {
        to: '/app/proposals',
        label: 'Proposals',
        icon: FileText,
        keywords: 'quotes estimates',
        visible: (r) => canAny(r, ['proposals.read.all', 'proposals.read.own']),
      },
      {
        to: '/app/services',
        label: 'Services',
        icon: Layers,
        keywords: 'catalog price list',
        visible: (r) => can(r, 'services.read'),
      },
    ],
  },
  {
    id: 'delivery',
    label: 'Project delivery',
    items: [
      {
        to: '/app/projects',
        label: 'Projects',
        icon: FolderKanban,
        keywords: 'delivery tasks milestones',
        visible: (r) =>
          canAny(r, ['projects.read.all', 'projects.read.member', 'projects.read.linked']),
      },
      {
        to: '/app/delivery',
        label: 'Delivery portfolio',
        icon: GanttChart,
        keywords: 'timeline gantt workload portfolio',
        visible: (r) => can(r, 'delivery.work'),
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      {
        to: '/app/invoices',
        label: 'Invoices',
        icon: Receipt,
        keywords: 'billing payments',
        visible: (r) => canAny(r, ['invoices.read.all', 'invoices.read.project']),
      },
      {
        to: '/app/reports/finance',
        label: 'Finance report',
        icon: BarChart3,
        keywords: 'aging receivables profit revenue trend',
        visible: (r) => can(r, 'finance.view'),
      },
      {
        to: '/app/finance/cost-rates',
        label: 'Cost rates',
        icon: Coins,
        keywords: 'hourly cost',
        visible: (r) => can(r, 'finance.view'),
      },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      {
        to: '/app/team',
        label: 'Team',
        icon: UserCog,
        keywords: 'members invite roles',
        visible: (r) => can(r, 'team.read'),
      },
      {
        to: '/app/imports',
        label: 'Imports',
        icon: FileUp,
        keywords: 'csv upload',
        visible: (r) => can(r, 'imports.run'),
      },
      {
        to: '/app/settings',
        label: 'Settings',
        icon: Settings,
        keywords: 'agency currency timezone',
        visible: (r) => can(r, 'agency.manage'),
      },
    ],
  },
];

/** The nav entry a path belongs to (longest prefix wins), for the header's context line. */
export function sectionFor(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) {
        if (!best || item.to.length > best.item.to.length) best = { group, item };
      }
    }
  }
  return best;
}
