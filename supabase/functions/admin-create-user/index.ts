import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const allowedRoles = new Set([
  "worker",
  "inventory_manager",
  "slitting_manager",
  "admin",
  "super_admin",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: caller },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isSuperAdmin } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "super_admin",
    });
    const { data: isAdmin } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });

    if (!isSuperAdmin && !isAdmin) {
      return new Response(JSON.stringify({ error: "Only admins can create users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    const employeeId = String(body.employee_id ?? "").trim();
    const requestedDepartment = String(body.requested_department ?? "worker").trim();
    const roles = Array.isArray(body.roles)
      ? body.roles.map((role) => String(role).trim()).filter(Boolean)
      : [];

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "A valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!password || password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!name) {
      return new Response(JSON.stringify({ error: "Name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!employeeId) {
      return new Response(JSON.stringify({ error: "Employee ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allowedRoles.has(requestedDepartment)) {
      return new Response(JSON.stringify({ error: "Invalid requested department" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (roles.length === 0) {
      return new Response(JSON.stringify({ error: "Select at least one role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (roles.some((role) => !allowedRoles.has(role))) {
      return new Response(JSON.stringify({ error: "One or more roles are invalid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isSuperAdmin && roles.includes("super_admin")) {
      return new Response(JSON.stringify({ error: "Only super admins can create another super admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        employee_id: employeeId,
        requested_department: requestedDepartment,
      },
    });

    if (createError || !created.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Could not create user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = created.user.id;

    const { error: profileError } = await adminClient.from("profiles").upsert(
      {
        user_id: userId,
        name,
        employee_id: employeeId,
        username: email,
        requested_department: requestedDepartment,
        status: "active",
      },
      { onConflict: "user_id" },
    );

    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roleRows = Array.from(new Set(roles)).map((role) => ({ user_id: userId, role }));
    const { error: rolesError } = await adminClient.from("user_roles").insert(roleRows);

    if (rolesError) {
      await adminClient.from("profiles").delete().eq("user_id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: rolesError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          user_id: userId,
          email,
          name,
          employee_id: employeeId,
          requested_department: requestedDepartment,
          roles: roleRows.map((row) => row.role),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});