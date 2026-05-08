import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, ShieldCheck, ShieldOff, Eye, Loader2, X, Check } from "lucide-react";
import { adminApi, type AdminUser } from "@/lib/auth-api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface UserFormData {
  username: string;
  password: string;
  role: "admin" | "viewer";
}

const EMPTY_FORM: UserFormData = { username: "", password: "", role: "viewer" };

export default function AdminUtilizadores() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [resetTotpId, setResetTotpId] = useState<number | null>(null);
  const [resettingTotp, setResettingTotp] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await adminApi.listUsers();
      setUsers(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditTarget(null);
    setDialogMode("create");
  };

  const openEdit = (u: AdminUser) => {
    setForm({ username: u.username, password: "", role: u.role });
    setFormError(null);
    setEditTarget(u);
    setDialogMode("edit");
  };

  const closeDialog = () => { setDialogMode(null); setEditTarget(null); };

  const handleSave = async () => {
    setFormError(null);
    setSaving(true);
    try {
      if (dialogMode === "create") {
        if (!form.username || !form.password) {
          setFormError("Username e password são obrigatórios");
          return;
        }
        await adminApi.createUser(form);
      } else if (dialogMode === "edit" && editTarget) {
        const updates: Partial<UserFormData> = { role: form.role };
        if (form.username) updates.username = form.username;
        if (form.password) updates.password = form.password;
        await adminApi.updateUser(editTarget.id, updates);
      }
      closeDialog();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(true);
    try {
      await adminApi.deleteUser(id);
      setDeleteId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const handleResetTotp = async (id: number) => {
    setResettingTotp(true);
    try {
      await adminApi.resetUserTotp(id);
      setResetTotpId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResettingTotp(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gestão de Utilizadores</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Administrar acessos ao Supervisor Virtual</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo utilizador
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id} className="border">
              <CardContent className="flex items-center gap-4 py-3 px-4">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold uppercase">{u.username.slice(0, 2)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{u.username}</span>
                    {u.id === me?.id && (
                      <Badge variant="outline" className="text-[10px]">tu</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Criado em {format(new Date(u.createdAt), "d MMM yyyy", { locale: ptBR })}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={u.role === "admin"
                    ? "gap-1 bg-amber-50 text-amber-700 border-amber-200"
                    : "gap-1 bg-stone-50 text-stone-600 border-stone-200"}
                >
                  {u.role === "admin"
                    ? <><ShieldCheck className="h-3 w-3" />Admin</>
                    : <><Eye className="h-3 w-3" />Viewer</>}
                </Badge>
                <Badge
                  variant="outline"
                  className={u.totpEnabled
                    ? "gap-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                    : "gap-1 bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600"}
                >
                  {u.totpEnabled
                    ? <><ShieldCheck className="h-3 w-3" />2FA activo</>
                    : <><ShieldOff className="h-3 w-3" />Sem 2FA</>}
                </Badge>
                {u.totpEnabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setResetTotpId(u.id)}
                    disabled={u.id === me?.id}
                    title="Repor 2FA deste utilizador"
                  >
                    Repor 2FA
                  </Button>
                )}
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(u)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(u.id)}
                    disabled={u.id === me?.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Novo utilizador" : "Editar utilizador"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="nome.apelido"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{dialogMode === "edit" ? "Nova password (deixe em branco para manter)" : "Password"}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as "admin" | "viewer" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — acesso total + gestão de utilizadores</SelectItem>
                  <SelectItem value="viewer">Viewer — só leitura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formError && (
              <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset 2FA confirm */}
      <Dialog open={resetTotpId !== null} onOpenChange={(open) => { if (!open) setResetTotpId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Repor autenticação de dois fatores?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O 2FA e os códigos de recuperação deste utilizador serão eliminados. Na próxima sessão poderá configurar novamente.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTotpId(null)} disabled={resettingTotp}>Cancelar</Button>
            <Button variant="destructive" onClick={() => resetTotpId && handleResetTotp(resetTotpId)} disabled={resettingTotp} className="gap-2">
              {resettingTotp ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
              Repor 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar utilizador?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)} disabled={deleting} className="gap-2">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
