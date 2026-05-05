import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DateProvider } from "@/lib/date-context";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Conversas from "@/pages/conversas";
import ConversaDetalhe from "@/pages/conversa-detalhe";
import Operadores from "@/pages/operadores";
import Metodologia from "@/pages/metodologia";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/conversas" component={Conversas} />
        <Route path="/conversas/:id" component={ConversaDetalhe} />
        <Route path="/operadores" component={Operadores} />
        <Route path="/metodologia" component={Metodologia} />
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </DateProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
