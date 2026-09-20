import { Router } from "express";
import { analyticsController } from "./analytics.controller";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();
router.use(requireAuth);

router.get("/tests", asyncHandler(analyticsController.listTests));
router.get("/tests/:testName", asyncHandler(analyticsController.getTestHistory));

export default router;
