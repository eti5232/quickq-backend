import type { Request, Response } from 'express';
import { currentUser } from '../../middleware/authenticate.js';
import { idParam } from '../../utils/validation.js';
import {
  approveJoinRequestSchema,
  clinicsQuery,
  createClinicSchema,
  joinRequestsQuery,
  rejectJoinRequestSchema,
  updateClinicSchema,
  updateUserSchema,
  usersQuery,
} from './admin.schemas.js';
import * as service from './admin.service.js';

export async function listJoinRequests(req: Request, res: Response) {
  res.json(await service.listJoinRequests(joinRequestsQuery.parse(req.query)));
}
export async function approveJoinRequest(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { email } = approveJoinRequestSchema.parse(req.body ?? {});
  res.status(201).json(await service.approveJoinRequest(id, email));
}
export async function rejectJoinRequest(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { reason } = rejectJoinRequestSchema.parse(req.body ?? {});
  res.json(await service.rejectJoinRequest(id, reason));
}

export async function listClinics(req: Request, res: Response) {
  res.json(await service.listClinics(clinicsQuery.parse(req.query)));
}
export async function createClinic(req: Request, res: Response) {
  res.status(201).json(await service.createClinic(createClinicSchema.parse(req.body)));
}
export async function updateClinic(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.updateClinic(id, updateClinicSchema.parse(req.body)));
}

export async function listUsers(req: Request, res: Response) {
  res.json(await service.listUsers(usersQuery.parse(req.query)));
}
export async function updateUser(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.updateUser(currentUser(req).id, id, updateUserSchema.parse(req.body)));
}
export async function resetUserPassword(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.resetUserPassword(currentUser(req).id, id));
}
