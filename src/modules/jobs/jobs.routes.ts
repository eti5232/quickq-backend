import { Router } from 'express';
import * as controller from './jobs.controller.js';

export const jobsRouter = Router();

jobsRouter.post('/send-reminders', controller.sendReminders);
