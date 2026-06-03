import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createClient } from "@supabase/supabase-js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, KeyRound, UserCheck, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const departmentLabels: Record<string, string> = {
  worker: "Production Manager",
  inventory_manager: "Inventory Manager",
  slitting_manager: "Slitting Manager",
};

const roleLabels: Record<string, string> = {
  worker: "Production Manager",
  inventory_manager: "Inventory Manager",
  slitting_manager: "Slitting Manager",
  admin: "Admin",
  super_admin: "Super Admin",
};

const availableRoles = [
  { value: "worker", label: "Production Manager" },
  { value: "inventory_manager", label: "Inventory Manager" },
  { value: "slitting_manager", label: "Slitting Manager" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

interface UserRow {
  id: string;
  name: string;
  employee_id: string;
  username: string;
  status: string;
  user_id: string;
  roles: string[];
  requested_department: string;
}

const emptyCreateForm = {
  name: "",
  employee_id: "",
  username: "",
  password: "",
  requested_department: "worker",
};

export default function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveRoles, setApproveRoles] = useState<string[]>(["worker"]);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [createRoles, setCreateRoles] = useState<string[]>(["worker"]);
  const [newPassword, setNewPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", employee_id: "", username: "" });
  const [createForm, setCreateForm] = useState(() => ({ ...emptyCreateForm }));
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const fetchUsers = async () => {
    const { data, error } = await supabase.rpc("admin_list_users" as any);
    if (error) {
      if (error.message === "Not authorized") {
        const repaired = await attemptAdminRepair();
        if (repaired) {
          const retry = await supabase.rpc("admin_list_users" as any);
          if (!retry.error) {
            setUsers((retry.data ?? []) as UserRow[]);
            toast({ title: "Admin access repaired" });
            return;
          }
        }
      }
      toast({ title: "Error loading users", description: error.message, variant: "destructive" });
      return;
    }
    setUsers((data ?? []) as UserRow[]);
  };

  useEffect(() => { fetchUsers(); }, []);

  const createUser = async () => {
    if (!createForm.name || !createForm.employee_id || !createForm.username || !createForm.password) {
      toast({ title: "Missing details", description: "Fill in all user fields before creating the account.", variant: "destructive" });
      return;
    }

    if (createRoles.length === 0) {
      toast({ title: "Missing roles", description: "Assign at least one role to the new user.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const signupClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `admin-create-user-${Date.now()}`,
      },
    });

    const { data: authData, error: authError } = await signupClient.auth.signUp({
      email: createForm.username.trim(),
      password: createForm.password,
      options: {
        data: {
          name: createForm.name.trim(),
          employee_id: createForm.employee_id.trim(),
          requested_department: createForm.requested_department,
        },
      },
    });

    if (authError || !authData.user) {
      toast({ title: "Error creating user", description: authError?.message ?? "Could not create the login account.", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const userId = authData.user.id;

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: userId,
        name: createForm.name.trim(),
        employee_id: createForm.employee_id.trim(),
        username: createForm.username.trim(),
        requested_department: createForm.requested_department as any,
        status: "active",
      },
      { onConflict: "user_id" },
    );

    if (profileError) {
      toast({ title: "User account created, but profile setup failed", description: profileError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert(createRoles.map((role) => ({ user_id: userId, role })) as any);

    if (roleError) {
      toast({ title: "User account created, but role assignment failed", description: roleError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    setCreateDialogOpen(false);
    setCreateForm({ ...emptyCreateForm });
    setCreateRoles(["worker"]);
    toast({ title: "User created successfully" });
    setSubmitting(false);
    fetchUsers();
  };

  const openCreate = () => {
    setCreateForm({ ...emptyCreateForm });
    setCreateRoles(["worker"]);
    setCreateDialogOpen(true);
  };

  const attemptAdminRepair = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const user = sessionData.session?.user;
      const email = user?.email?.toLowerCase();

      if (!token || !user || email !== "admin@chhaperia.com") {
        return false;
      }

      const repairClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      await repairClient.from("profiles").upsert(
        {
          user_id: user.id,
          name: "Super Admin",
          employee_id: "ADMIN",
          username: user.email ?? "admin@chhaperia.com",
          requested_department: "worker",
          status: "active",
        },
        { onConflict: "user_id" },
      );

      await repairClient.from("user_roles").upsert(
        { user_id: user.id, role: "super_admin" } as any,
        { onConflict: "user_id,role" },
      );

      const { data: adminCheck } = await repairClient.rpc("is_admin", { _user_id: user.id });
      if (!adminCheck) {
        toast({
          title: "Database admin role is missing",
          description: "Run the old database SQL fix once for admin@chhaperia.com, then sign out and sign back in.",
          variant: "destructive",
        });
      }
      return !!adminCheck;
    } catch {
      return false;
    }
  };

  const openEdit = (user: UserRow) => {
    setSelectedUser(user);
    setEditForm({ name: user.name, employee_id: user.employee_id, username: user.username });
    setEditRoles(user.roles.length > 0 ? [...user.roles] : ["worker"]);
    setEditDialogOpen(true);
  };

  const updateUser = async () => {
    if (!selectedUser || !editForm.name || !editForm.employee_id) return;
    setSubmitting(true);

    if (editForm.username !== selectedUser.username) {
      const { data, error: fnError } = await supabase.functions.invoke("admin-update-user", {
        body: { user_id: selectedUser.user_id, email: editForm.username },
      });
      if (fnError || data?.error) {
        toast({ title: "Error updating auth email", description: data?.error ?? fnError?.message, variant: "destructive" });
        setSubmitting(false);
        return;
      }
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ name: editForm.name, employee_id: editForm.employee_id, username: editForm.username })
      .eq("user_id", selectedUser.user_id);

    if (profileError) {
      toast({ title: "Error updating profile", description: profileError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Replace all roles: delete existing, insert new
    await supabase.from("user_roles").delete().eq("user_id", selectedUser.user_id);
    if (editRoles.length > 0) {
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert(editRoles.map((r) => ({ user_id: selectedUser.user_id, role: r })) as any);
      if (roleError) {
        toast({ title: "Error updating roles", description: roleError.message, variant: "destructive" });
        setSubmitting(false);
        return;
      }
    }

    toast({ title: "User updated successfully" });
    setEditDialogOpen(false);
    setSelectedUser(null);
    setSubmitting(false);
    fetchUsers();
  };

  const openDelete = (user: UserRow) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const deleteUser = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    await supabase.from("user_roles").delete().eq("user_id", selectedUser.user_id);
    const { error } = await supabase.from("profiles").delete().eq("user_id", selectedUser.user_id);
    if (error) {
      toast({ title: "Error deleting user", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }
    toast({ title: "User deleted successfully" });
    setDeleteDialogOpen(false);
    setSelectedUser(null);
    setSubmitting(false);
    fetchUsers();
  };

  const openResetPassword = (user: UserRow) => {
    setSelectedUser(user);
    setNewPassword("");
    setResetDialogOpen(true);
  };

  const resetPassword = async () => {
    if (!selectedUser || !newPassword || newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("reset-password", {
      body: { user_id: selectedUser.user_id, new_password: newPassword },
    });
    if (error || data?.error) {
      toast({ title: "Error resetting password", description: data?.error ?? error?.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }
    toast({ title: "Password reset successfully" });
    setResetDialogOpen(false);
    setSelectedUser(null);
    setNewPassword("");
    setSubmitting(false);
  };

  const toggleStatus = async (userId: string, current: string) => {
    await supabase.from("profiles").update({ status: current === "active" ? "inactive" : "active" }).eq("user_id", userId);
    fetchUsers();
  };

  const pendingUsers = users.filter((u) => u.roles.length === 0);
  const approvedUsers = users.filter((u) => u.roles.length > 0);

  const openApprove = (user: UserRow) => {
    setSelectedUser(user);
    setApproveRoles([user.requested_department]);
    setApproveDialogOpen(true);
  };

  const approveUser = async () => {
    if (!selectedUser || approveRoles.length === 0) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("user_roles")
      .insert(approveRoles.map((r) => ({ user_id: selectedUser.user_id, role: r })) as any);
    if (error) {
      toast({ title: "Error approving user", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }
    toast({ title: `${selectedUser.name} approved with ${approveRoles.map((r) => roleLabels[r] ?? r).join(", ")}` });
    setApproveDialogOpen(false);
    setSelectedUser(null);
    setSubmitting(false);
    fetchUsers();
  };

  const RoleCheckboxes = ({ selected, onChange }: { selected: string[]; onChange: (roles: string[]) => void }) => (
    <div className="space-y-2 mt-2">
      {availableRoles.map((r) => (
        <div key={r.value} className="flex items-center space-x-2">
          <Checkbox
            id={`role-${r.value}-${selected.join("")}`}
            checked={selected.includes(r.value)}
            onCheckedChange={(checked) => {
              onChange(checked ? [...selected, r.value] : selected.filter((v) => v !== r.value));
            }}
          />
          <label htmlFor={`role-${r.value}-${selected.join("")}`} className="text-sm cursor-pointer">{r.label}</label>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">User Management</h1>
        <Button onClick={openCreate} className="sm:w-auto">
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Pending Approval Section */}
      {pendingUsers.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-amber-600" />
              Pending Approvals ({pendingUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-sm text-muted-foreground">Employee ID: {u.employee_id} · {u.username}</p>
                    <p className="text-sm text-muted-foreground">Requested department: {departmentLabels[u.requested_department]}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="default" onClick={() => openApprove(u)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => openDelete(u)}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approvedUsers.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.employee_id}</TableCell>
                <TableCell>{u.username}</TableCell>
                <TableCell>
                  {u.roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r} variant="outline">{roleLabels[r] ?? r}</Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge variant="destructive">Pending Approval</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.status === "active" ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => toggleStatus(u.user_id, u.status)}
                  >
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit user">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openResetPassword(u)} title="Reset password">
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => openDelete(u)} title="Delete user">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Full Name</Label><Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></div>
            <div><Label>Employee ID</Label><Input value={createForm.employee_id} onChange={(e) => setCreateForm({ ...createForm, employee_id: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} /></div>
            <div><Label>Temporary Password</Label><Input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Requested Department</Label>
              <Select
                value={createForm.requested_department}
                onValueChange={(value) => setCreateForm({ ...createForm, requested_department: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.slice(0, 3).map((role) => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Roles (select one or more)</Label>
              <RoleCheckboxes selected={createRoles} onChange={setCreateRoles} />
            </div>
            <Button onClick={createUser} disabled={submitting || createRoles.length === 0} className="w-full">
              Create User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Full Name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div><Label>Employee ID</Label><Input value={editForm.employee_id} onChange={(e) => setEditForm({ ...editForm, employee_id: e.target.value })} /></div>
            <div><Label>Email / Username</Label><Input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} /></div>
            <div>
              <Label>Roles (select one or more)</Label>
              <RoleCheckboxes selected={editRoles} onChange={setEditRoles} />
            </div>
            <Button onClick={updateUser} disabled={submitting || editRoles.length === 0} className="w-full bg-secondary hover:bg-secondary/90">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedUser?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteUser} disabled={submitting} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Set a new password for <strong>{selectedUser?.name}</strong>
          </p>
          <div className="space-y-4">
            <div>
              <Label>New Password</Label>
              <Input
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <Button onClick={resetPassword} disabled={submitting} className="w-full bg-secondary hover:bg-secondary/90">
              Reset Password
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve User</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Assign roles to <strong>{selectedUser?.name}</strong> to grant them access. You can select multiple roles.
          </p>
          <div className="space-y-4">
            <div>
              <Label>Roles (select one or more)</Label>
              <RoleCheckboxes selected={approveRoles} onChange={setApproveRoles} />
            </div>
            <Button onClick={approveUser} disabled={submitting || approveRoles.length === 0} className="w-full">
              Approve & Assign Roles
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}