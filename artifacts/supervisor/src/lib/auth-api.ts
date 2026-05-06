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
  totpEnabled: boolean;
}

export interface LoginResult {
  totpRequired?: true;
  id?: number;
  username?: string;
  role?: "admin" | "viewer";
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
    apiFetch<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  totpVerify: (code: string) =>
    apiFetch<AuthUser>("/auth/totp/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  totpStatus: () => apiFetch<{ totpEnabled: boolean }>("/auth/totp/status"),
  totpSetupInit: () => apiFetch<{ secret: string; qrDataUrl: string }>("/auth/totp/setup"),
  totpSetupConfirm: (code: string) =>
    apiFetch<{ ok: boolean }>("/auth/totp/setup", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  totpDisable: (code: string) =>
    apiFetch<{ ok: boolean }>("/auth/totp", {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }),
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
