import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/env.js';
import { openApiSpec } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { generalLimiter } from './middleware/rate-limit.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { clinicsRouter } from './modules/clinics/clinics.routes.js';
import { providersRouter } from './modules/providers/providers.routes.js';
import { appointmentsRouter } from './modules/appointments/appointments.routes.js';
import { joinRequestsRouter } from './modules/join-requests/join-requests.routes.js';
import { manageRouter } from './modules/manage/manage.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { jobsRouter } from './modules/jobs/jobs.routes.js';

export function createApp() {
  const app = express();

  // ב-Render השרת יושב מאחורי Proxy - נדרש כדי לזהות את כתובת ה-IP האמיתית (להגבלת ניסיונות)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: config.corsOrigins === '*' ? '*' : config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Disposition'],
    }),
  );

  // Swagger UI - עם הגדרות אבטחה שמאפשרות לממשק לעבוד
  app.get('/api-docs/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use(
    '/api-docs',
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'QuickQ API Docs',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.json({ name: 'QuickQ API', docs: '/api-docs', health: '/api/health' });
  });

  app.use('/api', generalLimiter);
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/clinics', clinicsRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/join-requests', joinRequestsRouter);
  app.use('/api/manage', manageRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/jobs', jobsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
