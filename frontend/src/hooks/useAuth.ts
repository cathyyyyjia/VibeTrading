import { useAuth as useAuthContext } from "@/contexts/AuthContext";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } = options ?? {};
  const { user, loading, signOut } = useAuthContext();

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const state = useMemo(() => {
    return {
      user: user ?? null,
      loading,
      error: null,
      isAuthenticated: Boolean(user),
    };
  }, [loading, user]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (loading) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    loading,
    state.user,
  ]);

  return {
    ...state,
    refresh: async () => undefined,
    logout,
  };
}
