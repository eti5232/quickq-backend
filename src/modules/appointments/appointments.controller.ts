import type { Request, Response } from 'express';
import { currentUser } from '../../middleware/authenticate.js';
import { serializeAppointment } from '../../utils/serializers.js';
import { idParam } from '../../utils/validation.js';
import {
  bookAppointmentSchema,
  cancelSchema,
  myAppointmentsQuery,
  updateAppointmentSchema,
} from './appointments.schemas.js';
import * as service from './appointments.service.js';

export async function listMine(req: Request, res: Response) {
  const q = myAppointmentsQuery.parse(req.query);
  res.json(await service.listMine(currentUser(req).id, q));
}

export async function book(req: Request, res: Response) {
  const input = bookAppointmentSchema.parse(req.body);
  res.status(201).json(await service.book(currentUser(req).id, input));
}

export async function getById(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const user = currentUser(req);
  const a = await service.getAppointmentForUser(user, id);
  res.json(serializeAppointment(a, { includeClient: user.role !== 'CLIENT' }));
}

export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = updateAppointmentSchema.parse(req.body);
  res.json(await service.updateByClient(currentUser(req).id, id, input));
}

export async function cancel(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { reason } = cancelSchema.parse(req.body ?? {});
  res.json(await service.cancel(currentUser(req), id, reason));
}
