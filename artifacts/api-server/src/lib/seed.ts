import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger.js";

export async function seedAdminUser(): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing.length > 0) return;

  const passwordHash = await bcrypt.hash("admin123", 12);
  await db.insert(usersTable).values({
    username: "admin",
    passwordHash,
    role: "admin",
  });
  logger.info("Default admin user created — username: admin, password: admin123 (altere já!)");
}
