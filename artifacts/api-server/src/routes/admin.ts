import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAdmin } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.use(requireAdmin);

router.get("/admin/users", async (_req, res): Promise<void> => {
  const users = await db
    .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role, createdAt: usersTable.createdAt, totpSecret: usersTable.totpSecret })
    .from(usersTable)
    .orderBy(usersTable.username);
  res.json(users.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt.toISOString(), totpEnabled: !!u.totpSecret })));
});

router.post("/admin/users", async (req, res): Promise<void> => {
  const { username, password, role } = req.body as { username?: string; password?: string; role?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username e password obrigatórios" });
    return;
  }
  const roleVal = role === "admin" ? "admin" : "viewer";
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const [user] = await db
      .insert(usersTable)
      .values({ username: username.trim().toLowerCase(), passwordHash, role: roleVal })
      .returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, createdAt: usersTable.createdAt });
    res.status(201).json({ ...user, createdAt: user.createdAt.toISOString() });
  } catch {
    res.status(409).json({ error: "Username já existe" });
  }
});

router.put("/admin/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { username, password, role } = req.body as { username?: string; password?: string; role?: string };

  const updates: Partial<{ username: string; passwordHash: string; role: "admin" | "viewer" }> = {};
  if (username) updates.username = username.trim().toLowerCase();
  if (password) updates.passwordHash = await bcrypt.hash(password, 12);
  if (role === "admin" || role === "viewer") updates.role = role;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nenhum campo para atualizar" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, createdAt: usersTable.createdAt });

  if (!updated) {
    res.status(404).json({ error: "Utilizador não encontrado" });
    return;
  }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/admin/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const remaining = await db.select({ id: usersTable.id }).from(usersTable);
  if (remaining.length <= 1) {
    res.status(400).json({ error: "Não é possível eliminar o último utilizador" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

export default router;
