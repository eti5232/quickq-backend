import { Router } from 'express';
import { publicFormLimiter } from '../../middleware/rate-limit.js';
import * as controller from './join-requests.controller.js';

/** פניות הצטרפות - שליחה ציבורית */
export const joinRequestsRouter = Router();

joinRequestsRouter.post('/', publicFormLimiter, controller.create);
