import { NextFunction, Request, Response, Router } from "express";
import { reportsController } from "./reports.controller";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, uploadMiddleware } from "./upload.middleware";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { rateLimit } from "../../middleware/rateLimit";
import { ValidationError } from "../../utils/errors";

const router = Router();
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "upload" });

// Signed-URL file access does not require the Authorization header (the
// token itself carries the authorization), so this is registered before
// requireAuth applies to the rest of the router.
router.get("/file/:token", asyncHandler(reportsController.getFileByToken));

router.use(requireAuth);

function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadMiddleware(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string })?.code;
      if (code === "LIMIT_FILE_SIZE") {
        return next(new ValidationError("This file is too large. Please choose a file under 15MB."));
      }
      return next(
        new ValidationError("We couldn't upload this file. Please check the file type and size and try again.")
      );
    }
    const file = req.file;
    const extension = file ? "." + file.originalname.split(".").pop()?.toLowerCase() : "";
    if (!file || !ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
      return next(new ValidationError("We couldn't upload this file. Please check the file type and size and try again."));
    }
    next();
  });
}

router.post("/upload", uploadLimiter, handleUpload, asyncHandler(reportsController.upload));
router.get("/", asyncHandler(reportsController.list));
router.get("/dashboard-summary", asyncHandler(reportsController.dashboardSummary));
router.get("/:id", asyncHandler(reportsController.getOne));
router.patch("/:id", asyncHandler(reportsController.update));
router.delete("/:id", asyncHandler(reportsController.remove));
router.post("/:id/verify", asyncHandler(reportsController.verify));
router.post("/:id/archive", asyncHandler(reportsController.archive));
router.get("/:id/file", asyncHandler(reportsController.getFile));
router.get("/:id/file-url", asyncHandler(reportsController.getFileUrl));
router.get("/:id/fields", asyncHandler(reportsController.listFields));
router.patch("/:id/fields", asyncHandler(reportsController.updateFields));
router.delete("/:id/fields/:fieldId", asyncHandler(reportsController.deleteField));
router.delete("/:id/test-values/:testValueId", asyncHandler(reportsController.deleteTestValue));

export default router;
