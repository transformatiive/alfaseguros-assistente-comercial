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
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

// Public routes (no auth needed)
router.use(healthRouter);
router.use(authRouter);
// n8n-facing routes — authenticated by bearer token, not session
router.use(followupsRouter);
router.use(emailSummaryRouter);

// Protected routes — must be authenticated
router.use(requireAuth);
router.use(adminRouter);
router.use(runsRouter);
router.use(conversationsRouter);
router.use(summaryRouter);
router.use(operatorsRouter);
router.use(casesRouter);
router.use(actionsRouter);

export default router;
