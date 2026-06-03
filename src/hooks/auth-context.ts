import { createContext } from "react";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = string | null;
export type SignupDepartment = "worker" | "inventory_manager" | "slitting_manager" | "admin";

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole;
  roles: string[];
  profileName: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string, employeeId: string, requestedDepartment: SignupDepartment) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isPending: boolean;
  isWorker: boolean;
  isInventoryManager: boolean;
  isSlittingManager: boolean;
  hasRole: (r: string) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
