import { Request, Response } from "express";
import { authService } from "./auth.service";
import { loginSchema, refreshSchema, registerSchema } from "./schemas";
import { ValidationError } from "../../utils/errors";

export const authController = {
  async register(req: Request, res: Response) {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
    const { email, password } = parsed.data;
    const result = await authService.register(email, password);
    res.status(201).json(result);
  },

  async login(req: Request, res: Response) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Email and password are required.");
    const result = await authService.login(parsed.data.email, parsed.data.password);
    res.json(result);
  },

  async refresh(req: Request, res: Response) {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("A refresh token is required.");
    const result = await authService.refresh(parsed.data.refreshToken);
    res.json(result);
  },

  async logout(req: Request, res: Response) {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) await authService.logout(parsed.data.refreshToken);
    res.status(204).send();
  },
};
