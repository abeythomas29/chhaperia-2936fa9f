import { useEffect, useState, ReactNode, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthContext, type AppRole, type SignupDepartment } from "./auth-context";


const signUpSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255, "Email is too long"),
  password: z.string().min(6, "Password must be at least 6 characters").max(72, "Password is too long"),
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  employeeId: z.string().trim().min(1, "Employee ID is required").max(50, "Employee ID is too long"),
  requestedDepartment: z.enum(["worker", "inventory_manager", "slitting_manager", "sales_manager"]),
});



export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const SUPER_ADMIN_EMAILS = ["admin@chhaperia.com"];

  const ensureSuperAdminRole = async (userId: string) => {
    const { data: existing } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!existing) {
      await supabase.from("user_roles").insert({ user_id: userId, role: "super_admin" });
    }
  };

  const fetchRoles = async (userId: string, email: string | null | undefined, retries = 3) => {
    const isKnownSuperAdmin = !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (data && data.length > 0) {
      const userRoles = data.map((r) => r.role);
      setRoles(userRoles);
      const priority = ["super_admin", "admin", "worker", "inventory_manager", "slitting_manager", "sales_manager"];
      const primary = priority.find((p) => userRoles.includes(p)) ?? userRoles[0];
      setRole(primary);
      return;
    }

    if (isKnownSuperAdmin) {
      await ensureSuperAdminRole(userId);
      setRoles(["super_admin"]);
      setRole("super_admin");
      return;
    }

    if (retries > 0) {
      setTimeout(() => fetchRoles(userId, email, retries - 1), 1000);
    } else {
      setRole("pending");
      setRoles([]);
    }
  };


  const fetchProfile = async (userId: string, retries = 3) => {
    const { data } = await supabase
      .from("profiles")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.name) {
      setProfileName(data.name);
    } else if (retries > 0) {
      setTimeout(() => fetchProfile(userId, retries - 1), 1000);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // If the token refresh failed, sign out cleanly
        if (_event === 'TOKEN_REFRESHED' && !session) {
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          setRole(null);
          setRoles([]);
          setProfileName(null);
          setLoading(false);
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => {
            fetchRoles(session.user.id, session.user.email);
            fetchProfile(session.user.id);
          }, 0);
        } else {
          setRole(null);
          setProfileName(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        supabase.auth.signOut().catch(() => {});
        setSession(null);
        setUser(null);
        setRole(null);
        setRoles([]);
        setProfileName(null);
        setLoading(false);
        return;
      }
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRoles(session.user.id, session.user.email);
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, name: string, employeeId: string, requestedDepartment: SignupDepartment) => {
    const parsed = signUpSchema.safeParse({ email, password, name, employeeId, requestedDepartment });
    if (!parsed.success) {
      return { error: new Error(parsed.error.issues[0]?.message ?? "Invalid signup details") };
    }

    const sanitized = parsed.data;
    const { error } = await supabase.auth.signUp({
      email: sanitized.email,
      password: sanitized.password,
      options: {
        data: {
          name: sanitized.name,
          employee_id: sanitized.employeeId,
          requested_department: sanitized.requestedDepartment,
        },
      },
    });
    if (error) return { error: error as Error | null };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
    setRoles([]);
    setProfileName(null);
  };

  const hasRole = (r: string) => roles.includes(r);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        roles,
        profileName,
        loading,
        signIn,
        signUp,
        signOut,
        isAdmin: roles.includes("admin") || roles.includes("super_admin"),
        isSuperAdmin: roles.includes("super_admin"),
        isWorker: roles.includes("worker"),
        isPending: role === "pending" || (roles.length === 0 && !loading),
        isInventoryManager: roles.includes("inventory_manager"),
        isSlittingManager: roles.includes("slitting_manager"),
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
