// Typed DOM lookups. Centralized so casts only happen here.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function maybeById<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return (document.getElementById(id) as T | null) ?? null;
}
