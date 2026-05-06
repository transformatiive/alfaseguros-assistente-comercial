import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck, ShieldOff, QrCode, Loader2, Check, AlertTriangle,
  Copy, CopyCheck, RefreshCw, KeyRound,
} from "lucide-react";
import { authApi } from "@/lib/auth-api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type SetupState = "idle" | "scanning" | "confirming" | "showCodes" | "done";
type DisableState = "idle" | "confirming";

function RecoveryCodeGrid({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(codes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <code
            key={code}
            className="block font-mono text-sm bg-muted rounded px-3 py-1.5 text-center tracking-widest select-all"
          >
            {code}
          </code>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={handleCopy}
      >
        {copied ? <CopyCheck className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copiado!" : "Copiar todos"}
      </Button>
    </div>
  );
}

export default function Perfil() {
  const { user } = useAuth();
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Setup state
  const [setupState, setSetupState] = useState<SetupState>("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);

  // Disable state
  const [disableState, setDisableState] = useState<DisableState>("idle");
  const [disableCode, setDisableCode] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Recovery codes state (for active 2FA)
  const [codesRemaining, setCodesRemaining] = useState<number | null>(null);
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, codesRes] = await Promise.all([
        authApi.totpStatus(),
        authApi.recoveryCodes(),
      ]);
      setTotpEnabled(statusRes.totpEnabled);
      setCodesRemaining(codesRes.remaining);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const startSetup = async () => {
    setSetupError(null);
    setSetupLoading(true);
    try {
      const data = await authApi.totpSetupInit();
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setSetupState("scanning");
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupLoading(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    setSetupError(null);
    setSetupLoading(true);
    try {
      const result = await authApi.totpSetupConfirm(setupCode);
      setTotpEnabled(true);
      setNewRecoveryCodes(result.recoveryCodes);
      setSetupState("showCodes");
      setSetupCode("");
    } catch (e) {
      setSetupError((e as Error).message);
      setSetupCode("");
    } finally {
      setSetupLoading(false);
    }
  };

  const confirmDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError(null);
    setDisableLoading(true);
    try {
      await authApi.totpDisable(disableCode);
      setTotpEnabled(false);
      setCodesRemaining(null);
      setDisableState("idle");
      setDisableCode("");
      setRegenCodes(null);
    } catch (e) {
      setDisableError((e as Error).message);
      setDisableCode("");
    } finally {
      setDisableLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenError(null);
    setRegenLoading(true);
    try {
      const result = await authApi.recoveryCodesRegenerate();
      setRegenCodes(result.recoveryCodes);
      setCodesRemaining(result.recoveryCodes.length);
      setShowRegenConfirm(false);
    } catch (e) {
      setRegenError((e as Error).message);
    } finally {
      setRegenLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Definições da sua conta</p>
      </div>

      {/* Account info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informação da conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Utilizador</span>
            <span className="font-medium">{user?.username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Perfil</span>
            <span className="capitalize">{user?.role}</span>
          </div>
        </CardContent>
      </Card>

      {/* 2FA section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Autenticação em dois passos</CardTitle>
              <CardDescription className="mt-1">
                Proteja a sua conta com um segundo fator via app de autenticação.
              </CardDescription>
            </div>
            {!loadingStatus && (
              <Badge
                variant="outline"
                className={totpEnabled
                  ? "gap-1 bg-green-50 text-green-700 border-green-200"
                  : "gap-1 bg-stone-50 text-stone-500 border-stone-200"}
              >
                {totpEnabled
                  ? <><ShieldCheck className="h-3 w-3" />Activo</>
                  : <><ShieldOff className="h-3 w-3" />Inactivo</>}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {loadingStatus ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              A carregar...
            </div>
          ) : totpEnabled ? (
            /* --- 2FA ACTIVE: show recovery codes info + disable option --- */
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                O segundo factor está activo. Para desactivar, confirme com o código actual da sua app de autenticação.
              </p>

              {/* Recovery codes section */}
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    Códigos de recuperação
                  </div>
                  {codesRemaining !== null && (
                    <Badge
                      variant="outline"
                      className={
                        codesRemaining === 0
                          ? "bg-red-50 text-red-700 border-red-200"
                          : codesRemaining <= 2
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-stone-50 text-stone-600 border-stone-200"
                      }
                    >
                      {codesRemaining} restante{codesRemaining !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>

                {regenCodes ? (
                  /* Freshly regenerated codes — show them */
                  <div className="space-y-3">
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex gap-1.5 items-start">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      Guarde estes códigos num local seguro. Os códigos anteriores foram invalidados e não voltarão a ser mostrados.
                    </p>
                    <RecoveryCodeGrid codes={regenCodes} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setRegenCodes(null)}
                    >
                      Fechar
                    </Button>
                  </div>
                ) : showRegenConfirm ? (
                  /* Confirm regeneration */
                  <div className="space-y-3">
                    <p className="text-xs text-destructive">
                      Gerar novos códigos invalida todos os códigos actuais. Tem a certeza?
                    </p>
                    {regenError && (
                      <p className="text-xs text-destructive">{regenError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRegenConfirm(false)}
                        disabled={regenLoading}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleRegenerate}
                        disabled={regenLoading}
                        className="gap-2"
                      >
                        {regenLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Gerar novos códigos
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Default: show count + regenerate button */
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Use um código de recuperação para entrar caso perca acesso à sua app de autenticação. Cada código só funciona uma vez.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => { setShowRegenConfirm(true); setRegenError(null); }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Gerar novos códigos de recuperação
                    </Button>
                  </div>
                )}
              </div>

              {/* Disable 2FA */}
              {disableState === "idle" && (
                <Button
                  variant="outline"
                  className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => { setDisableState("confirming"); setDisableError(null); }}
                >
                  <ShieldOff className="h-4 w-4" />
                  Desactivar autenticação em dois passos
                </Button>
              )}

              {disableState === "confirming" && (
                <form onSubmit={confirmDisable} className="space-y-3 border rounded-lg p-4 bg-destructive/5 border-destructive/20">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Confirme a desactivação</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="disable-code">Código da app de autenticação</Label>
                    <Input
                      id="disable-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                      placeholder="000 000"
                      maxLength={7}
                      required
                      autoFocus
                      className="font-mono text-center tracking-widest"
                    />
                  </div>
                  {disableError && (
                    <p className="text-sm text-destructive">{disableError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setDisableState("idle"); setDisableCode(""); }} disabled={disableLoading}>
                      Cancelar
                    </Button>
                    <Button type="submit" variant="destructive" size="sm" disabled={disableLoading || disableCode.replace(/\s/g, "").length < 6} className="gap-2">
                      {disableLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Desactivar
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : setupState === "showCodes" ? (
            /* --- Show recovery codes immediately after setup --- */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <Check className="h-4 w-4 flex-shrink-0" />
                <span>Autenticação em dois passos activada com sucesso.</span>
              </div>

              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  Guarde os seus códigos de recuperação
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex gap-1.5 items-start">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  Se perder o telemóvel, poderá usar estes códigos para entrar na sua conta. Cada código funciona uma única vez. Guarde-os num local seguro — não voltarão a ser mostrados.
                </p>
                {newRecoveryCodes && <RecoveryCodeGrid codes={newRecoveryCodes} />}
              </div>

              <Button
                type="button"
                onClick={() => {
                  setSetupState("done");
                  setNewRecoveryCodes(null);
                  void fetchStatus();
                }}
                className="gap-2"
              >
                <Check className="h-4 w-4" />
                Já guardei os códigos
              </Button>
            </div>
          ) : setupState === "done" ? (
            /* --- Setup fully complete --- */
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <Check className="h-4 w-4 flex-shrink-0" />
              <span>Autenticação em dois passos activada com sucesso. Será pedido o código no próximo início de sessão.</span>
            </div>
          ) : setupState === "idle" ? (
            /* --- Idle: offer to enable --- */
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Quando activo, será pedido um código de 6 dígitos da sua app de autenticação após introduzir a password.
              </p>
              <Button onClick={startSetup} disabled={setupLoading} className="gap-2">
                {setupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                Activar autenticação em dois passos
              </Button>
              {setupError && (
                <p className="text-sm text-destructive">{setupError}</p>
              )}
            </div>
          ) : (
            /* --- Scanning / confirming QR --- */
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">1. Leia o QR code com a sua app</p>
                <p className="text-xs text-muted-foreground">
                  Use o Google Authenticator, Authy ou qualquer app TOTP compatível.
                </p>
                {qrDataUrl && (
                  <div className="inline-block border rounded-lg p-3 bg-white">
                    <img src={qrDataUrl} alt="QR code 2FA" className="h-40 w-40" />
                  </div>
                )}
              </div>

              <form onSubmit={confirmSetup} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="setup-code">2. Introduza o código para confirmar</Label>
                  <Input
                    id="setup-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                    placeholder="000 000"
                    maxLength={7}
                    required
                    className="font-mono text-center tracking-widest w-40"
                  />
                </div>
                {setupError && (
                  <p className="text-sm text-destructive">{setupError}</p>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setSetupState("idle"); setSecret(null); setQrDataUrl(null); setSetupCode(""); }}>
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" disabled={setupLoading || setupCode.replace(/\s/g, "").length < 6} className="gap-2">
                    {setupLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <Check className="h-3.5 w-3.5" />
                    Confirmar e activar
                  </Button>
                </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
