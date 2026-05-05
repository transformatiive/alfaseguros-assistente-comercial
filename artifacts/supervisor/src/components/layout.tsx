import { Link, useLocation } from "wouter";
import { Building, LogOut, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  const initials = user?.username?.slice(0, 2).toUpperCase() ?? "SV";

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Top header */}
      <header className="h-12 flex-shrink-0 border-b border-border bg-sidebar text-sidebar-foreground flex items-center px-6">
        <div className="flex items-center gap-2.5">
          <Building className="h-4 w-4 text-sidebar-primary" />
          <span className="font-semibold text-sm tracking-tight">Alfaseguros</span>
        </div>

        <div className="flex-1" />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-sidebar-accent transition-colors">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-medium leading-none">{user?.username ?? "—"}</p>
                <p className="text-[10px] text-sidebar-foreground/50 mt-0.5 capitalize">{user?.role ?? ""}</p>
              </div>
              <Avatar className="h-7 w-7 bg-sidebar-accent border border-sidebar-border">
                <AvatarFallback className="text-sidebar-foreground text-[10px]">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <div>
                <p className="font-medium text-sm">{user?.username}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </div>
            </DropdownMenuLabel>
            {user?.role === "admin" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/utilizadores" className="flex items-center gap-2 cursor-pointer">
                    <ShieldCheck className="h-4 w-4" />
                    Gerir utilizadores
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive gap-2 cursor-pointer"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Terminar sessão
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-6xl mx-auto px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
