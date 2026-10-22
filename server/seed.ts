import { hashPassword, newUser } from './auth/auth.ts';
import type { Role } from './auth/capabilities.ts';
import type { RegistryStore } from './store/types.ts';
import { newId, nowIso } from './util.ts';

/** Groups 1–3, as in EP Workspace (renamed later by the Admin). Idempotent. */
export async function ensureDefaultGroups(store: RegistryStore): Promise<void> {
  const existing = await store.listGroups();
  if (existing.length) return;
  for (const n of [1, 2, 3]) {
    await store.createGroup({ group_id: newId('grp'), name: `Group ${n}`, sort_order: n, next_seq: 1, is_deleted: false, created_at: nowIso() });
  }
}

/** Synthetic accounts for tests and local previews only. */
export async function seedTestUsers(store: RegistryStore, password: string, users: { username: string; name: string; role: Role; mustChange?: boolean; groupIndex?: number[] }[]) {
  await ensureDefaultGroups(store);
  const groups = (await store.listGroups()).sort((a, b) => a.sort_order - b.sort_order);
  const hash = await hashPassword(password);
  for (const u of users) {
    if (await store.findUserByUsername(u.username)) continue;
    await store.createUser(
      newUser({
        user_id: newId('usr'),
        username: u.username,
        display_name: u.name,
        role: u.role,
        groups: (u.groupIndex ?? [0]).map((i) => groups[i].group_id),
        password_hash: hash,
        must_change_password: !!u.mustChange,
      }),
    );
  }
}
