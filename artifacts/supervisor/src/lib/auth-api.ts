const BASE = "/api";

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "viewer";
}

export interface AdminUser {
  id: number;
  username: string;
  role: "admin" | "viewer";
  createdAt: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const authApi = {
  me: () => apiFetch<AuthUser>("/auth/me"),
  login: (username: string, password: string) =>
    apiFetch<AuthUser>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};

export const adminApi = {
  listUsers: () => apiFetch<AdminUser[]>("/admin/users"),
  createUser: (data: { username: string; password: string; role: string }) =>
    apiFetch<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: { username?: string; password?: string; role?: string }) =>
    apiFetch<AdminUser>(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: number) =>
    apiFetch<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" }),
};
