import { Outlet, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Scissors, History, LogOut, Loader2, ClipboardList, ShoppingCart, ListOrdered, Package, Layers } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function SlittingManagerLayout() {
  const { user, loading, signOut, profileName, isAdmin, isSlittingManager, isWorker, isSalesManager, isInventoryManager } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isSlittingManager && isAdmin) return <Navigate to="/admin" replace />;
  if (!isSlittingManager) return <Navigate to="/login" replace />;

  const navItems = [
    { to: "/slitting", label: "New Slitting", icon: Scissors, end: true },
    { to: "/slitting/history", label: "My History", icon: History, end: false },
  ];

  if (isWorker) {
    navItems.push({ to: "/worker", label: "Production", icon: ClipboardList, end: false });
  }
  if (isSalesManager) {
    navItems.push({ to: "/sales", label: "Record Sale", icon: ShoppingCart, end: true });
    navItems.push({ to: "/sales/history", label: "Sales History", icon: ListOrdered, end: false });
  }
  if (isInventoryManager) {
    navItems.push({ to: "/inventory", label: "Inventory", icon: Package, end: false });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-14 border-b bg-primary text-primary-foreground flex items-center justify-between px-4">
        <Link to="/slitting" className="flex items-center gap-3">
          <img src={logo} alt="Chhaperia Cables" className="h-8 w-auto" />
          <span className="font-bold text-sm">Chhaperia Cables</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-primary-foreground/10 rounded-full px-3 py-1">
            <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground text-xs font-bold">
              {(profileName ?? "U").charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium">{profileName ?? user?.email ?? "User"}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary/80">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <nav className="border-b bg-card flex gap-1 px-4">
        {navItems.map((item) => {
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                isActive
                  ? "border-secondary text-secondary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Outlet />
      </div>
    </div>
  );
}