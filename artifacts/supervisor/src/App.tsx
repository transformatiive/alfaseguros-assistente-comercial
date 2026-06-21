import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DateProvider } from "@/lib/date-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Conversas from "@/pages/conversas";
import ConversaDetalhe from "@/pages/conversa-detalhe";
import Operadores from "@/pages/operadores";
import Checklist from "@/pages/checklist";
import Pipeline from "@/pages/pipeline";
import AdminUtilizadores from "@/pages/admin-utilizadores";
import Perfil from "@/pages/perfil";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Never retry on 401 — session is gone, retrying won't help
        if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 401) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

/**
 * Subscribes to all QueryCache + MutationCache errors.
 * When any request returns 401, clears the auth state so the login
 * screen is shown immediately instead of leaving the user stuck.
 */
function QueryErrorInterceptor() {
  const { logout } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    function handle(error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        (error as { status: number }).status === 401
      ) {
        logout();
      }
    }

    const unsubQ = qc.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.query.state.status === "error") {
        handle(event.query.state.error);
      }
    });

    const unsubM = qc.getMutationCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.mutation?.state.status === "error"
      ) {
        handle(event.mutation.state.error);
      }
    });

    return () => {
      unsubQ();
      unsubM();
    };
  }, [qc, logout]);

  return null;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/conversas" component={Conversas} />
        <Route path="/conversas/:id" component={ConversaDetalhe} />
        <Route path="/operadores" component={Operadores} />
        <Route path="/checklist" component={Checklist} />
        <Route path="/pipeline" component={Pipeline} />
        <Route path="/perfil" component={Perfil} />
        {user.role === "admin" && (
          <Route path="/admin/utilizadores" component={AdminUtilizadores} />
        )}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={100}>
        <DateProvider>
          <AuthProvider>
            <QueryErrorInterceptor />
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AppRoutes />
            </WouterRouter>
          </AuthProvider>
        </DateProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
