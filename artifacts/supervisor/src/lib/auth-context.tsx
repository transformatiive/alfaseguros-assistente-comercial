import { createContext, useContext, useEffect, useState } from "react";
import { authApi, type AuthUser } from "./auth-api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  totpRequired: boolean;
  login: (username: string, password: string) => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [totpRequired, setTotpRequired] = useState(false);

  const refresh = async () => {
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    if (result.totpRequired) {
      setTotpRequired(true);
    } else {
      setTotpRequired(false);
      setUser(result as AuthUser);
    }
  };

  const verifyTotp = async (code: string) => {
    const me = await authApi.totpVerify(code);
    setTotpRequired(false);
    setUser(me);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
    setTotpRequired(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, totpRequired, login, verifyTotp, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
