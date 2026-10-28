import type { Request, Response } from 'express';
import { currentUser } from '../../middleware/authenticate.js';
import { managerClinicId } from '../../middleware/authorize.js';
import { badRequest } from '../../utils/app-error.js';
import { idParam } from '../../utils/validation.js';
import * as queue from '../../services/queue.service.js';
import { cancel as cancelAppointment } from '../appointments/appointments.service.js';
import { cancelSchema } from '../appointments/appointments.schemas.js';
import * as service from './manage.service.js';
import * as appts from './manage-appointments.service.js';
import * as importer from './import.service.js';
import {
  clientsQuery,
  createAbsenceSchema,
  createClinicAbsenceSchema,
  createProviderSchema,
  createStaffSchema,
  listAppointmentsQuery,
  manageBookSchema,
  manageUpdateAppointmentSchema,
  statusChangeSchema,
  updateClientSchema,
  updateClinicSchema,
  updateProviderSchema,
  updateStaffSchema,
  workingHoursSchema,
} from './manage.schemas.js';

// ---------- קליניקה ----------
export async function getClinic(req: Request, res: Response) {
  res.json(await service.getClinic(managerClinicId(req)));
}
export async function updateClinic(req: Request, res: Response) {
  res.json(await service.updateClinic(managerClinicId(req), updateClinicSchema.parse(req.body)));
}

// ---------- אנשי מקצוע ----------
export async function listProviders(req: Request, res: Response) {
  res.json(await service.listProviders(managerClinicId(req)));
}
export async function createProvider(req: Request, res: Response) {
  res.status(201).json(await service.createProvider(managerClinicId(req), createProviderSchema.parse(req.body)));
}
export async function updateProvider(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.updateProvider(managerClinicId(req), id, updateProviderSchema.parse(req.body)));
}
export async function getWorkingHours(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.getWorkingHours(managerClinicId(req), id));
}
export async function replaceWorkingHours(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.replaceWorkingHours(managerClinicId(req), id, workingHoursSchema.parse(req.body)));
}

// ---------- היעדרויות ----------
export async function listAbsences(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.listAbsences(managerClinicId(req), id));
}
export async function createAbsence(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.status(201).json(await service.createAbsence(managerClinicId(req), id, createAbsenceSchema.parse(req.body)));
}
export async function createClinicAbsence(req: Request, res: Response) {
  res.status(201).json(await service.createClinicAbsence(managerClinicId(req), createClinicAbsenceSchema.parse(req.body)));
}
export async function deleteAbsence(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  await service.deleteAbsence(managerClinicId(req), id);
  res.status(204).end();
}

// ---------- תורים ----------
export async function listAppointments(req: Request, res: Response) {
  res.json(await appts.listAppointments(managerClinicId(req), listAppointmentsQuery.parse(req.query)));
}
export async function bookForClient(req: Request, res: Response) {
  res.status(201).json(await appts.bookForClient(managerClinicId(req), manageBookSchema.parse(req.body)));
}
export async function updateAppointment(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await appts.updateAppointment(managerClinicId(req), id, manageUpdateAppointmentSchema.parse(req.body)));
}
export async function cancelAppointmentByClinic(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  managerClinicId(req);
  const { reason } = cancelSchema.parse(req.body ?? {});
  res.json(await cancelAppointment(currentUser(req), id, reason));
}
export async function changeStatus(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { status } = statusChangeSchema.parse(req.body);
  const updated = await queue.changeStatus(id, managerClinicId(req), status);
  res.json({ id: updated.id, status: updated.status, queueNumber: updated.queueNumber, arrivedAt: updated.arrivedAt, startedAt: updated.startedAt, completedAt: updated.completedAt });
}

// ---------- תור יומי ----------
async function ownProviderId(req: Request) {
  const { id } = idParam.parse(req.params);
  await service.getOwnProvider(managerClinicId(req), id);
  return id;
}
export async function getQueue(req: Request, res: Response) {
  res.json(await queue.getManagerQueue(await ownProviderId(req)));
}
export async function openQueue(req: Request, res: Response) {
  const id = await ownProviderId(req);
  await queue.openDay(id);
  res.json(await queue.getManagerQueue(id));
}
export async function pauseQueue(req: Request, res: Response) {
  const id = await ownProviderId(req);
  await queue.setDayStatus(id, 'PAUSED');
  res.json(await queue.getManagerQueue(id));
}
export async function resumeQueue(req: Request, res: Response) {
  const id = await ownProviderId(req);
  await queue.setDayStatus(id, 'OPEN');
  res.json(await queue.getManagerQueue(id));
}
export async function closeQueue(req: Request, res: Response) {
  const id = await ownProviderId(req);
  const result = await queue.closeDay(id);
  res.json({ markedCompleted: result.markedCompleted, markedNoShow: result.markedNoShow, queue: await queue.getManagerQueue(id) });
}
export async function nextInQueue(req: Request, res: Response) {
  const id = await ownProviderId(req);
  const result = await queue.nextInQueue(id);
  res.json({ ...result, queue: await queue.getManagerQueue(id) });
}

// ---------- לקוחות ----------
export async function listClients(req: Request, res: Response) {
  res.json(await service.listClients(managerClinicId(req), clientsQuery.parse(req.query)));
}
export async function updateClient(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.updateClient(managerClinicId(req), id, updateClientSchema.parse(req.body)));
}

// ---------- צוות ----------
export async function listStaff(req: Request, res: Response) {
  res.json(await service.listStaff(managerClinicId(req)));
}
export async function createStaff(req: Request, res: Response) {
  res.status(201).json(await service.createStaff(managerClinicId(req), createStaffSchema.parse(req.body)));
}
export async function updateStaff(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { isActive } = updateStaffSchema.parse(req.body);
  res.json(await service.updateStaff(managerClinicId(req), currentUser(req).id, id, isActive));
}

// ---------- ייבוא ----------
export async function importCsv(req: Request, res: Response) {
  const clinicId = managerClinicId(req);
  if (!req.file) throw badRequest('FILE_REQUIRED', 'יש לצרף קובץ CSV בשדה בשם file');
  res.json(await importer.importAppointments(clinicId, req.file.buffer));
}
export async function importTemplate(req: Request, res: Response) {
  const csv = await importer.buildTemplate(managerClinicId(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="quickq-import-template.csv"');
  res.send(csv);
}
