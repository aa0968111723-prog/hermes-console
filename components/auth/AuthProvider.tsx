"use client";
import { createContext, useContext } from "react";
import type { PublicSession } from "@/lib/contracts";

const AuthContext = createContext<PublicSession | null>(null);

export function AuthProvider({
  value,
  children,
}: {
  value: PublicSession;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
