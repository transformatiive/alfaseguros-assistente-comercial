import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: "admin" | "viewer";
    username: string;
    totpPending?: boolean;
    totpUserId?: number;
    totpSetupSecret?: string;
  }
}
