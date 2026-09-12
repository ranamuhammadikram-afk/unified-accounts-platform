import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("uap_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [businesses, setBusinesses] = useState([]);
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);

  const refreshBusinesses = useCallback(async () => {
    if (!localStorage.getItem("uap_token")) return;
    setLoadingBusinesses(true);
    try {
      const data = await api.get("/api/businesses");
      setBusinesses(data.businesses);
    } finally {
      setLoadingBusinesses(false);
    }
  }, []);

  useEffect(() => {
    if (user) refreshBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.id]);

  const login = useCallback(async (username, password) => {
    const data = await api.post("/api/auth/login", { username, password });
    localStorage.setItem("uap_token", data.token);
    localStorage.setItem("uap_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("uap_token");
    localStorage.removeItem("uap_user");
    setUser(null);
    setBusinesses([]);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem("uap_user", JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, businesses, loadingBusinesses, refreshBusinesses, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
