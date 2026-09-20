import { Router } from "express";
import { exportsController } from "./exports.controller";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();
router.use(requireAuth);

router.post("/", asyncHandler(exportsController.create));
router.get("/:id", asyncHandler(exportsController.getStatus));
router.get("/:id/download", asyncHandler(exportsController.download));

export default router;
