import { Building } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Top header — logo + avatar only */}
      <header className="h-12 flex-shrink-0 border-b border-border bg-sidebar text-sidebar-foreground flex items-center px-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <Building className="h-4 w-4 text-sidebar-primary" />
          <span className="font-semibold text-sm tracking-tight">Alfaseguros</span>
        </div>

        <div className="flex-1" />

        {/* User placeholder */}
        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium leading-none">Supervisor</p>
            <p className="text-[10px] text-sidebar-foreground/50 mt-0.5">Geral</p>
          </div>
          <Avatar className="h-7 w-7 bg-sidebar-accent border border-sidebar-border">
            <AvatarFallback className="text-sidebar-foreground text-[10px]">SV</AvatarFallback>
          </Avatar>
        </div>
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
