import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import * as controller from './appointments.controller.js';

/** תורים - לקוחות (וגם צפייה/ביטול למנהל הקליניקה) */
export const appointmentsRouter = Router();

appointmentsRouter.use(requireAuth());

appointmentsRouter.get('/my', requireRole('CLIENT'), controller.listMine);
appointmentsRouter.post('/', requireRole('CLIENT'), controller.book);
appointmentsRouter.get('/:id', controller.getById);
appointmentsRouter.patch('/:id', requireRole('CLIENT'), controller.update);
appointmentsRouter.post('/:id/cancel', requireRole('CLIENT', 'CLINIC_MANAGER'), controller.cancel);
