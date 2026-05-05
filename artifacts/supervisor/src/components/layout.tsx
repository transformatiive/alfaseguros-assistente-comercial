import { Link, useLocation } from "wouter";
import { LayoutDashboard, BookOpen, Building } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Visão Geral" },
    { href: "/metodologia", icon: BookOpen, label: "Guia de Leitura" },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Top header */}
      <header className="h-14 flex-shrink-0 border-b border-border bg-sidebar text-sidebar-foreground flex items-center px-6 gap-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <Building className="h-5 w-5 text-sidebar-primary" />
          <span className="font-semibold text-base tracking-tight">Alfaseguros</span>
        </div>

        <div className="h-5 w-px bg-sidebar-border" />

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User */}
        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium leading-none">Supervisor</p>
            <p className="text-[10px] text-sidebar-foreground/50 mt-0.5">Geral</p>
          </div>
          <Avatar className="h-8 w-8 bg-sidebar-accent border border-sidebar-border">
            <AvatarFallback className="text-sidebar-foreground text-xs">SV</AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
