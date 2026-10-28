import type { Request, Response } from 'express';
import { currentUser } from '../../middleware/authenticate.js';
import * as service from './auth.service.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateMeSchema,
} from './auth.schemas.js';

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await service.register(input));
}

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await service.login(email, password));
}

export async function me(req: Request, res: Response) {
  res.json(await service.getMe(currentUser(req).id));
}

export async function updateMe(req: Request, res: Response) {
  const input = updateMeSchema.parse(req.body);
  res.json(await service.updateMe(currentUser(req).id, input));
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  res.json(await service.changePassword(currentUser(req).id, currentPassword, newPassword));
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = forgotPasswordSchema.parse(req.body);
  res.json(await service.forgotPassword(email));
}

export async function resetPassword(req: Request, res: Response) {
  const { email, code, newPassword } = resetPasswordSchema.parse(req.body);
  res.json(await service.resetPassword(email, code, newPassword));
}
