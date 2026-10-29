// Per-device look and per-user defaults (owner, step 6): Light / Dark / Auto, text size, default group.
// Kept in this browser only; nothing here is sent to the server.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'auto';
export type TextSize = 'small' | 'normal' | 'large' | 'larger';

export const TEXT_SIZES: Record<TextSize, string> = { small: '93.75%', normal: '100%', large: '112.5%', larger: '125%' };

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getTheme = (): Theme => (read('ep.theme') as Theme) || 'auto';
export const getTextSize = (): TextSize => (read('ep.textsize') as TextSize) || 'normal';

/** Puts the saved theme and text size on <html>; called at start and after each change. */
export function applyPrefs() {
  const root = document.documentElement;
  const t = getTheme();
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t;
  root.style.fontSize = TEXT_SIZES[getTextSize()] ?? '100%';
}

export function setTheme(t: Theme) {
  write('ep.theme', t === 'auto' ? null : t);
  applyPrefs();
  emit();
}
export function setTextSize(s: TextSize) {
  write('ep.textsize', s === 'normal' ? null : s);
  applyPrefs();
  emit();
}

const groupKey = (userId: string) => `ep.defaultgroup.${userId}`;
export const getDefaultGroup = (userId: string | undefined) => (userId ? read(groupKey(userId)) : null);
export function setDefaultGroup(userId: string, groupId: string | null) {
  write(groupKey(userId), groupId);
  emit();
}

/** Re-renders when any preference changes. */
export function usePrefs() {
  const snap = useSyncExternalStore(subscribe, () => `${getTheme()}|${getTextSize()}`);
  const [theme, size] = snap.split('|') as [Theme, TextSize];
  return { theme, size };
}

/** The group New case and Bulk add start on: the user's default when they still belong to it, else the first. */
export function pickGroup(userId: string | undefined, groups: { group_id: string }[], preferred?: string | null): string {
  const def = getDefaultGroup(userId);
  if (preferred && groups.some((g) => g.group_id === preferred)) return preferred;
  if (def && groups.some((g) => g.group_id === def)) return def;
  return groups[0]?.group_id ?? '';
}
