import { Router } from 'express';
import * as controller from './clinics.controller.js';

/** קליניקות - ציבורי (ללא התחברות) */
export const clinicsRouter = Router();

clinicsRouter.get('/', controller.search);
clinicsRouter.get('/cities', controller.cities);
clinicsRouter.get('/:id', controller.getById);
