import { Link, useLocation } from "wouter";
import { LayoutDashboard, MessageSquareText, Users, Building, BookOpen } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Visão Geral" },
    { href: "/metodologia", icon: BookOpen, label: "Guia de Leitura" },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col text-sidebar-foreground">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <Building className="h-6 w-6 text-sidebar-primary mr-3" />
          <span className="font-semibold text-lg tracking-tight">Alfaseguros</span>
        </div>
        
        <div className="flex-1 py-6 px-4 flex flex-col gap-1 overflow-y-auto">
          <div className="px-2 pb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
            Menu
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center px-3 py-2 rounded-md transition-colors ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
                <item.icon className="h-4 w-4 mr-3" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 bg-sidebar-accent border border-sidebar-border">
              <AvatarFallback className="text-sidebar-foreground">SV</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Supervisor</span>
              <span className="text-xs text-sidebar-foreground/60">Geral</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
