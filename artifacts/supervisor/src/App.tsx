import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DateProvider } from "@/lib/date-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Conversas from "@/pages/conversas";
import ConversaDetalhe from "@/pages/conversa-detalhe";
import Operadores from "@/pages/operadores";
import Pipeline from "@/pages/pipeline";
import AdminUtilizadores from "@/pages/admin-utilizadores";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

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
        <Route path="/pipeline" component={Pipeline} />
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
      <TooltipProvider>
        <DateProvider>
          <AuthProvider>
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
