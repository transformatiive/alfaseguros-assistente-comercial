import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import adminRouter from "./admin.js";
import runsRouter from "./runs.js";
import conversationsRouter from "./conversations.js";
import summaryRouter from "./summary.js";
import operatorsRouter from "./operators.js";
import casesRouter from "./cases.js";
import actionsRouter from "./actions.js";
import followupsRouter from "./followups.js";
import emailSummaryRouter from "./email-summary.js";
import alertasRouter from "./alertas.js";
import checklistAdminRouter from "./checklist-admin.js";
import statsRouter from "./stats.js";
import leadsRouter from "./leads.js";
import agenteRouter from "./agente.js";
import painelRefreshRouter from "./painel-refresh.js";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

// Public routes (no auth needed)
router.use(healthRouter);
router.use(authRouter);
// n8n-facing routes — authenticated by bearer token, not session
router.use(followupsRouter);
router.use(emailSummaryRouter);
router.use(alertasRouter);
// /api/run has its own cron-secret guard; move before requireAuth so n8n can call it
router.use(runsRouter);
// Checklist admin (seed/backfill/stats) — cron-secret guarded, before requireAuth
router.use(checklistAdminRouter);
// Public leads dashboard, also reachable at /api/leads (the front-end SPA layer
// serves the top-level /leads, so this alias guarantees a backend-reachable URL).
router.use(leadsRouter);
// Agent panel — its own bearer-token guard (requireAgent), not the session
// cookie, so it must be mounted before requireAuth.
router.use(agenteRouter);
// Panel refresh — cron-secret guarded like /api/run, so it must sit before
// requireAuth. Never calls the LLM.
router.use(painelRefreshRouter);

// Protected routes — must be authenticated
router.use(requireAuth);
router.use(adminRouter);
router.use(conversationsRouter);
router.use(summaryRouter);
router.use(operatorsRouter);
router.use(casesRouter);
router.use(actionsRouter);
router.use(statsRouter);

export default router;
