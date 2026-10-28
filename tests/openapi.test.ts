import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../src/docs/openapi.js';
import { authRouter } from '../src/modules/auth/auth.routes.js';
import { clinicsRouter } from '../src/modules/clinics/clinics.routes.js';
import { providersRouter } from '../src/modules/providers/providers.routes.js';
import { appointmentsRouter } from '../src/modules/appointments/appointments.routes.js';
import { joinRequestsRouter } from '../src/modules/join-requests/join-requests.routes.js';
import { manageRouter } from '../src/modules/manage/manage.routes.js';
import { adminRouter } from '../src/modules/admin/admin.routes.js';
import { jobsRouter } from '../src/modules/jobs/jobs.routes.js';
import { healthRouter } from '../src/modules/health/health.routes.js';
import { api } from './helpers.js';

/** מוציא את כל הנתיבים שהוגדרו בפועל ב-Express */
function routesOf(prefix: string, router: Router): string[] {
  const out: string[] = [];
  for (const layer of (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack) {
    if (!layer.route) continue;
    const path = `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`.replace(/:(\w+)/g, '{$1}');
    for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${path}`);
  }
  return out;
}

const implemented = [
  ...routesOf('/api/health', healthRouter),
  ...routesOf('/api/auth', authRouter),
  ...routesOf('/api/clinics', clinicsRouter),
  ...routesOf('/api/providers', providersRouter),
  ...routesOf('/api/appointments', appointmentsRouter),
  ...routesOf('/api/join-requests', joinRequestsRouter),
  ...routesOf('/api/manage', manageRouter),
  ...routesOf('/api/admin', adminRouter),
  ...routesOf('/api/jobs', jobsRouter),
].sort();

const documented = Object.entries(openApiSpec.paths)
  .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`))
  .sort();

describe('OpenAPI / Swagger', () => {
  it('is a valid OpenAPI 3 document', async () => {
    const copy = JSON.parse(JSON.stringify(openApiSpec));
    await expect(SwaggerParser.validate(copy)).resolves.toBeTruthy();
  });

  it('documents exactly the implemented endpoints', () => {
    expect(implemented.length).toBeGreaterThan(50);
    expect(documented).toEqual(implemented);
  });

  it('documents responses, auth requirements and examples for every endpoint', () => {
    for (const ops of Object.values(openApiSpec.paths)) {
      for (const op of Object.values(ops) as { summary: string; description: string; responses: Record<string, unknown>; security: unknown[] }[]) {
        expect(op.summary).toBeTruthy();
        expect(op.description).toMatch(/ציבורי|דורש Token/);
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
        if (op.description.includes('דורש Token')) {
          expect(op.security).toEqual([{ bearerAuth: [] }]);
          expect(op.responses).toHaveProperty('401');
          expect(op.responses).toHaveProperty('403');
        }
      }
    }
    expect(openApiSpec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  });

  it('serves Swagger UI at /api-docs and the JSON spec', async () => {
    const ui = await api().get('/api-docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
    const json = await api().get('/api-docs/openapi.json');
    expect(json.status).toBe(200);
    expect(json.body.openapi).toBe('3.0.3');
    expect(json.body.servers).toEqual([{ url: '/', description: expect.any(String) }]);
  });

  it('keeps docs/openapi.json in sync with the code', () => {
    const file = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(openApiSpec)));
  });
});

describe('Prisma', () => {
  it('schema is valid and all migrations are applied to the test database', () => {
    execSync('npx prisma validate', { stdio: 'pipe' });
    const status = execSync('npx prisma migrate status', { stdio: 'pipe', env: process.env }).toString();
    expect(status).toMatch(/up to date/i);
  });
});
