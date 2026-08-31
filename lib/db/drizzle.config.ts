import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // `user_sessions` é criada por SQL em bruto no arranque da API
  // (setupSessionStore(), para o connect-pg-simple) e nunca fez parte do schema
  // Drizzle. Sem esta exclusão, o `drizzle-kit push` vê uma tabela que não
  // conhece e pergunta, interativamente, se `runs` é uma tabela nova ou um
  // *rename* de `user_sessions`. Num deploy não há ninguém para responder: o
  // push fica pendurado e o schema nunca é aplicado — e, se alguém responder
  // "rename" ou passar --force, a tabela de sessões viva é destruída.
  tablesFilter: ["*", "!user_sessions"],
});
