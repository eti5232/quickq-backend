import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import * as c from './admin.controller.js';

/** מנהל על בלבד */
export const adminRouter = Router();

adminRouter.use(requireAuth(), requireRole('SUPER_ADMIN'));

adminRouter.get('/join-requests', c.listJoinRequests);
adminRouter.post('/join-requests/:id/approve', c.approveJoinRequest);
adminRouter.post('/join-requests/:id/reject', c.rejectJoinRequest);

adminRouter.get('/clinics', c.listClinics);
adminRouter.post('/clinics', c.createClinic);
adminRouter.patch('/clinics/:id', c.updateClinic);

adminRouter.get('/users', c.listUsers);
adminRouter.patch('/users/:id', c.updateUser);
adminRouter.post('/users/:id/reset-password', c.resetUserPassword);
