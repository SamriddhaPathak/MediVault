import { Router } from "express";
import { authController } from "./auth.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { rateLimit } from "../../middleware/rateLimit";

const router = Router();
const authLimiter = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "auth" });

router.post("/register", authLimiter, asyncHandler(authController.register));
router.post("/login", authLimiter, asyncHandler(authController.login));
router.post("/refresh", authLimiter, asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));

export default router;
