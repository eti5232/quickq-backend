import { Router } from 'express';
import { optionalAuth } from '../../middleware/authenticate.js';
import * as controller from './providers.controller.js';

/** אנשי מקצוע - זמינות ותור חי (ציבורי) */
export const providersRouter = Router();

providersRouter.get('/:id/availability', controller.availability);
providersRouter.get('/:id/slots', controller.slots);
// Token לא חובה - אם נשלח Token של לקוח עם תור היום, מתווסף "התור שלי"
providersRouter.get('/:id/live', optionalAuth(), controller.live);
