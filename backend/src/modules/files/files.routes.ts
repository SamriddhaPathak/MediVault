import { Request, Response, Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError } from "../../utils/errors";
import { mimeTypeForFileKey, storageService, verifySignedFileToken } from "../../services/storage.service";

const router = Router();

/**
 * Public path (no Authorization header) but the token itself is HMAC-signed
 * and time-limited, and encodes the exact fileKey it grants access to — so
 * it can never be used to browse or guess another patient's files.
 *
 * The Content-Type header is not optional here: helmet sends
 * `X-Content-Type-Options: nosniff`, so serving these bytes as the Express
 * default `application/octet-stream` makes browsers refuse to render them
 * in an <img> or <iframe>. That previously broke the Image Vault grid, both
 * document previews, and the profile photo.
 */
router.get(
  "/:token",
  asyncHandler(async (req: Request, res: Response) => {
    const verified = verifySignedFileToken(req.params.token);
    if (!verified) throw new NotFoundError("This link has expired or is invalid.");

    const buffer = await storageService.read(verified.fileKey);
    res.setHeader("Content-Type", mimeTypeForFileKey(verified.fileKey));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  })
);

export default router;
