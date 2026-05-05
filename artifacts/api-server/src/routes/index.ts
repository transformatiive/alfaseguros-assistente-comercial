import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import adminRouter from "./admin.js";
import runsRouter from "./runs.js";
import conversationsRouter from "./conversations.js";
import summaryRouter from "./summary.js";
import operatorsRouter from "./operators.js";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

// Public routes (no auth needed)
router.use(healthRouter);
router.use(authRouter);

// Protected routes — must be authenticated
router.use(requireAuth);
router.use(adminRouter);
router.use(runsRouter);
router.use(conversationsRouter);
router.use(summaryRouter);
router.use(operatorsRouter);

export default router;
