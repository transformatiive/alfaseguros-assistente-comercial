import { useState } from "react";
import { Building, Loader2, Eye, EyeOff, ShieldCheck, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function BrandHeader() {
  return (
    <div className="flex flex-col items-center gap-3 mb-8">
      <div className="h-12 w-12 rounded-xl bg-sidebar flex items-center justify-center border border-border">
        <Building className="h-6 w-6 text-sidebar-primary" />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight">Alfaseguros</h1>
        <p className="text-sm text-muted-foreground">Supervisor Virtual</p>
      </div>
    </div>
  );
}

function PasswordStep() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message ?? "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username">Utilizador</Label>
        <Input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="nome de utilizador"
          disabled={loading}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full gap-2" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}

function TotpStep() {
  const { verifyTotp, verifyRecoveryCode, logout } = useAuth();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (recovery: boolean) => {
    setUseRecovery(recovery);
    setCode("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (useRecovery) {
        await verifyRecoveryCode(code.trim());
      } else {
        await verifyTotp(code.replace(/\s/g, ""));
      }
    } catch (err) {
      setError((err as Error).message ?? "Código inválido");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        {useRecovery
          ? <><KeyRound className="h-4 w-4 text-primary" /><span>Código de recuperação</span></>
          : <><ShieldCheck className="h-4 w-4 text-primary" /><span>Autenticação em dois passos</span></>
        }
      </div>

      {useRecovery ? (
        <div className="space-y-1.5">
          <Label htmlFor="recovery-code">Código de recuperação</Label>
          <Input
            id="recovery-code"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="xxxxxx-xxxxxx"
            disabled={loading}
            required
            autoFocus
            className="font-mono tracking-widest"
          />
          <p className="text-xs text-muted-foreground">
            Introduza um dos códigos de recuperação guardados quando activou o 2FA.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="totp-code">Código da app de autenticação</Label>
          <Input
            id="totp-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000 000"
            disabled={loading}
            maxLength={7}
            required
            autoFocus
            className="text-center text-lg tracking-widest font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Introduza o código de 6 dígitos do Google Authenticator ou Authy.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full gap-2"
        disabled={loading || (!useRecovery && code.replace(/\s/g, "").length < 6)}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Verificar
      </Button>

      <div className="flex flex-col gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => switchMode(!useRecovery)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
        >
          {useRecovery
            ? "Usar código da app de autenticação"
            : "Usar código de recuperação"}
        </button>
        <button
          type="button"
          onClick={() => logout()}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
        >
          Voltar ao início de sessão
        </button>
      </div>
    </form>
  );
}

export default function Login() {
  const { totpRequired } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <BrandHeader />
        {totpRequired ? <TotpStep /> : <PasswordStep />}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Acesso restrito · Alfaseguros © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
