export type AuthUser = { id: string; email: string; display_name: string; role: "admin" | "user" };
export const TOKEN_KEY = "room-memory-auth-token";
export const USER_KEY = "room-memory-auth-user";
export function readAuthUser(): AuthUser | null {
  try { const raw = localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) as AuthUser : null; } catch { return null; }
}
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers });
}
export function saveSession(token: string, user: AuthUser) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
export function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
