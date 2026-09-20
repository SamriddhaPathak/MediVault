import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getStoredTokens, storeTokens } from "../services/api";

interface User {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const USER_KEY = "mv_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const tokens = getStoredTokens();
    if (!tokens) {
      setUser(null);
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  async function login(email: string, password: string) {
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password });
      storeTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });
      localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
      setUser(res.data.user);
    } finally {
      setLoading(false);
    }
  }

  async function register(email: string, password: string, confirmPassword: string) {
    setLoading(true);
    try {
      const res = await api.post("/auth/register", { email, password, confirmPassword });
      storeTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });
      localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
      setUser(res.data.user);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    const tokens = getStoredTokens();
    try {
      if (tokens?.refreshToken) await api.post("/auth/logout", { refreshToken: tokens.refreshToken });
    } catch {
      // best-effort
    }
    storeTokens(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
