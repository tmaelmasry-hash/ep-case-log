// Role → capability map, ported from EP Workspace (plan A11). Checked on the server for every route; the UI only mirrors it.
// Members add single cases, move them to the recycle bin, reopen with a reason and export their own group.
// Bulk add, restore, moving between groups, users/groups/settings, dashboard and full export are Admin only.
export type Role = 'ADMIN' | 'MEMBER';
export type Capability =
  | 'case.read' | 'case.create' | 'case.edit' | 'case.complete' | 'case.reopen' | 'case.import'
  | 'case.reassign' | 'case.delete' | 'case.restore'
  | 'ai.extract' | 'report.pdf'
  | 'export.group' | 'export.all'
  | 'dashboard.view' | 'mywork.view' | 'users.manage' | 'groups.manage' | 'settings.manage' | 'audit.view';

const MEMBER: Capability[] = [
  'case.read', 'case.create', 'case.edit', 'case.complete', 'case.reopen', 'case.delete',
  'ai.extract', 'report.pdf', 'export.group', 'mywork.view',
];
const ADMIN: Capability[] = [
  ...MEMBER, 'case.import', 'case.reassign', 'case.restore', 'export.all',
  'dashboard.view', 'users.manage', 'groups.manage', 'settings.manage', 'audit.view',
];

export function capabilitiesOf(role: Role): Capability[] {
  return role === 'ADMIN' ? ADMIN : MEMBER;
}

export function can(role: Role, cap: Capability): boolean {
  return capabilitiesOf(role).includes(cap);
}
