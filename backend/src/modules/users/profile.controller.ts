import { Request, Response } from "express";
import { z } from "zod";
import { profileService } from "./profile.service";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { storageService } from "../../services/storage.service";

const profileSchema = z.object({
  displayName: z.string().max(80).optional(),
  phone: z.string().max(30).optional(),
  emergencyContact: z.string().max(120).optional(),
  preferredUnits: z.enum(["metric", "imperial"]).optional(),
  age: z.number().int().min(0).max(130).optional(),
  bloodGroup: z.string().max(10).optional(),
  allergies: z.string().max(2000).optional(),
  knownConditions: z.string().max(2000).optional(),
});

export const profileController = {
  async get(req: Request, res: Response) {
    const profile = await profileService.get(req.user!.sub);
    if (!profile) {
      res.json({ profile: null });
      return;
    }
    const { profilePhotoKey, ...safeProfile } = profile;
    res.json({
      profile: {
        ...safeProfile,
        profilePhotoUrl: profilePhotoKey ? await storageService.getSignedUrl(profilePhotoKey, 15) : null,
      },
    });
  },

  async update(req: Request, res: Response) {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid profile data");
    const profile = await profileService.upsert(req.user!.sub, parsed.data);
    const { profilePhotoKey, ...safeProfile } = profile;
    res.json({
      profile: {
        ...safeProfile,
        profilePhotoUrl: profilePhotoKey ? await storageService.getSignedUrl(profilePhotoKey, 15) : null,
      },
    });
  },

  async uploadPhoto(req: Request, res: Response) {
    if (!req.file) throw new ValidationError("Choose a JPG, PNG, or WebP image under 5MB.");
    const current = await profileService.get(req.user!.sub);
    const profilePhotoKey = await storageService.save(req.file.buffer, req.file.originalname, req.user!.sub);
    const profile = await profileService.upsert(req.user!.sub, { profilePhotoKey });
    if (current?.profilePhotoKey) await storageService.delete(current.profilePhotoKey);
    const { profilePhotoKey: _storedPhotoKey, ...safeProfile } = profile;
    res.json({
      profile: {
        ...safeProfile,
        profilePhotoUrl: await storageService.getSignedUrl(profilePhotoKey, 15),
      },
    });
  },

  async removePhoto(req: Request, res: Response) {
    const current = await profileService.get(req.user!.sub);
    if (!current?.profilePhotoKey) throw new NotFoundError("No profile photo to remove.");
    await storageService.delete(current.profilePhotoKey);
    await profileService.upsert(req.user!.sub, { profilePhotoKey: null });
    res.status(204).send();
  },
};
