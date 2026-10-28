import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { loginLimiter, publicFormLimiter } from '../../middleware/rate-limit.js';
import * as controller from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', publicFormLimiter, controller.register);
authRouter.post('/login', loginLimiter, controller.login);
authRouter.post('/forgot-password', publicFormLimiter, controller.forgotPassword);
authRouter.post('/reset-password', loginLimiter, controller.resetPassword);

// מותר גם כשהמשתמש עוד חייב להחליף סיסמה זמנית
const authPending = requireAuth({ allowPendingPasswordChange: true });
authRouter.get('/me', authPending, controller.me);
authRouter.patch('/me', requireAuth(), controller.updateMe);
authRouter.post('/change-password', authPending, controller.changePassword);
