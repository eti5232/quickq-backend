import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import * as c from './manage.controller.js';

/** ניהול קליניקה - רק למנהל קליניקה, ותמיד רק על הקליניקה שלו */
export const manageRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

manageRouter.use(requireAuth(), requireRole('CLINIC_MANAGER'));

manageRouter.get('/clinic', c.getClinic);
manageRouter.patch('/clinic', c.updateClinic);

manageRouter.get('/providers', c.listProviders);
manageRouter.post('/providers', c.createProvider);
manageRouter.patch('/providers/:id', c.updateProvider);
manageRouter.get('/providers/:id/working-hours', c.getWorkingHours);
manageRouter.put('/providers/:id/working-hours', c.replaceWorkingHours);
manageRouter.get('/providers/:id/absences', c.listAbsences);
manageRouter.post('/providers/:id/absences', c.createAbsence);
manageRouter.post('/absences', c.createClinicAbsence);
manageRouter.delete('/absences/:id', c.deleteAbsence);

manageRouter.get('/providers/:id/queue', c.getQueue);
manageRouter.post('/providers/:id/queue/open', c.openQueue);
manageRouter.post('/providers/:id/queue/pause', c.pauseQueue);
manageRouter.post('/providers/:id/queue/resume', c.resumeQueue);
manageRouter.post('/providers/:id/queue/close', c.closeQueue);
manageRouter.post('/providers/:id/queue/next', c.nextInQueue);

manageRouter.get('/appointments/import/template', c.importTemplate);
manageRouter.post('/appointments/import', upload.single('file'), c.importCsv);
manageRouter.get('/appointments', c.listAppointments);
manageRouter.post('/appointments', c.bookForClient);
manageRouter.patch('/appointments/:id', c.updateAppointment);
manageRouter.post('/appointments/:id/cancel', c.cancelAppointmentByClinic);
manageRouter.post('/appointments/:id/status', c.changeStatus);

manageRouter.get('/clients', c.listClients);
manageRouter.patch('/clients/:id', c.updateClient);

manageRouter.get('/staff', c.listStaff);
manageRouter.post('/staff', c.createStaff);
manageRouter.patch('/staff/:id', c.updateStaff);
