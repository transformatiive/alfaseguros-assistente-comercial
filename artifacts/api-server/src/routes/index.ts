import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runsRouter from "./runs";
import conversationsRouter from "./conversations";
import summaryRouter from "./summary";
import operatorsRouter from "./operators";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runsRouter);
router.use(conversationsRouter);
router.use(summaryRouter);
router.use(operatorsRouter);

export default router;
