import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";

const signupSchema = z.object({
  name: z.string().trim().min(1, "Full name is required").max(100, "Full name is too long"),
  employeeId: z.string().trim().min(1, "Employee ID is required").max(50, "Employee ID is too long"),
  email: z.string().trim().email("Enter a valid email address").max(255, "Email is too long"),
  password: z.string().min(6, "Password must be at least 6 characters").max(72, "Password is too long"),
  requestedDepartment: z.enum(["worker", "inventory_manager", "slitting_manager"], {
    required_error: "Please select a department",
  }),
});

export default function Login() {
  const { signIn, signUp, signOut: authSignOut, user, role, loading, isPending, profileName } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmployeeId, setSignupEmployeeId] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupDepartment, setSignupDepartment] = useState<"worker" | "inventory_manager" | "slitting_manager">("worker");
  const [submitting, setSubmitting] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const { toast } = useToast();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user && role) {
    if (role === "worker") return <Navigate to="/worker" replace />;
    if (role === "inventory_manager") return <Navigate to="/inventory" replace />;
    if (role === "slitting_manager") return <Navigate to="/slitting" replace />;
    return <Navigate to="/admin" replace />;
  }

  // User is authenticated but role hasn't loaded yet — brief wait
  if (user && !role) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your account...</p>
        <Button variant="outline" size="sm" onClick={async () => { await authSignOut(); window.location.reload(); }}>
          Sign out and try again
        </Button>
      </div>
    );
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse({
      name: signupName,
      employeeId: signupEmployeeId,
      email: signupEmail,
      password: signupPassword,
      requestedDepartment: signupDepartment,
    });

    if (!parsed.success) {
      toast({ title: "Signup failed", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { name, employeeId, email, password, requestedDepartment } = parsed.data;
    const { error } = await signUp(email, password, name, employeeId, requestedDepartment);
    if (error) {
      toast({ title: "Signup failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Account created!", description: "Please wait for an administrator to review your requested department and assign your role." });
      setSignupName("");
      setSignupEmployeeId("");
      setSignupEmail("");
      setSignupPassword("");
      setSignupDepartment("worker");
    }
    setSubmitting(false);
  };

  return (
    <>
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4">
            <img src={logo} alt="Chhaperia Cables" className="h-16 w-auto mx-auto" />
          </div>
          <h1 className="text-2xl font-bold text-primary">Chhaperia Cables</h1>
          <p className="text-sm text-muted-foreground mt-1">Production Tracking System</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input id="signup-name" placeholder="Your full name" value={signupName} onChange={(e) => setSignupName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-eid">Employee ID</Label>
                  <Input id="signup-eid" placeholder="e.g. EMP001" value={signupEmployeeId} onChange={(e) => setSignupEmployeeId(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" placeholder="your@email.com" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" type="password" placeholder="Min 6 characters" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Requested Department</Label>
                  <Select value={signupDepartment} onValueChange={(value) => setSignupDepartment(value as "worker" | "inventory_manager" | "slitting_manager") }>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worker">Production Manager</SelectItem>
                      <SelectItem value="inventory_manager">Inventory Manager</SelectItem>
                      <SelectItem value="slitting_manager">Slitting Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Account
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Your account will stay pending until an admin approves your requested department.
                </p>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  By creating an account, you agree to our{" "}
                  <a
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-primary hover:text-primary/80 transition-colors"
                  >
                    Privacy Policy
                  </a>.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>

    <Dialog open={showPrivacy} onOpenChange={setShowPrivacy}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Privacy Policy</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 text-sm text-muted-foreground pr-4">
            <p><strong className="text-foreground">Effective Date:</strong> March 27, 2026</p>
            <p>Chhaperia Cables ("we", "our", "us") operates the Production Tracking System. This policy describes how we collect, use, and protect your information.</p>
            <h3 className="font-semibold text-foreground">1. Information We Collect</h3>
            <p>We collect your name, employee ID, email address, and production data you enter into the system. This information is necessary to operate the tracking system and manage production workflows.</p>
            <h3 className="font-semibold text-foreground">2. How We Use Your Information</h3>
            <p>Your information is used to authenticate your account, track production entries, manage stock and client records, and generate reports for internal business use.</p>
            <h3 className="font-semibold text-foreground">3. Data Storage & Security</h3>
            <p>Your data is stored securely on cloud infrastructure with encryption at rest and in transit. Access is restricted based on your assigned role (worker or admin).</p>
            <h3 className="font-semibold text-foreground">4. Data Sharing</h3>
            <p>We do not sell or share your personal information with third parties. Data is only accessible to authorized administrators within the organization.</p>
            <h3 className="font-semibold text-foreground">5. Your Rights</h3>
            <p>You may request access to, correction of, or deletion of your personal data by contacting your administrator.</p>
            <h3 className="font-semibold text-foreground">6. Changes to This Policy</h3>
            <p>We may update this policy from time to time. Continued use of the system constitutes acceptance of the updated policy.</p>
            <h3 className="font-semibold text-foreground">7. Contact</h3>
            <p>For questions about this policy, contact your system administrator.</p>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
    </>
  );
}
