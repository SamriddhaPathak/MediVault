import { NextFunction, Request, Response, Router } from "express";
import { profileController } from "./profile.controller";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import multer from "multer";
import { ValidationError } from "../../utils/errors";

const router = Router();
router.use(requireAuth);

const photoUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
			cb(new ValidationError("Choose a JPG, PNG, or WebP image under 5MB."));
			return;
		}
		cb(null, true);
	},
}).single("photo");

function handlePhotoUpload(req: Request, res: Response, next: NextFunction) {
	photoUpload(req, res, (err: unknown) => {
		if (err) return next(new ValidationError("Choose a JPG, PNG, or WebP image under 5MB."));
		next();
	});
}

router.get("/", asyncHandler(profileController.get));
router.patch("/", asyncHandler(profileController.update));
router.post("/photo", handlePhotoUpload, asyncHandler(profileController.uploadPhoto));
router.delete("/photo", asyncHandler(profileController.removePhoto));
// Deletes the whole account (see profile.service.ts#deleteAccount), not just
// the health-profile row — kept on the profile router since it's triggered
// from the Edit Profile screen and needs no id param (always "me").
router.delete("/", asyncHandler(profileController.deleteAccount));

export default router;
