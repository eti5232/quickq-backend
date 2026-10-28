import type { Request, Response } from 'express';
import { idParam } from '../../utils/validation.js';
import { searchClinicsSchema } from './clinics.schemas.js';
import * as service from './clinics.service.js';

export async function search(req: Request, res: Response) {
  const input = searchClinicsSchema.parse(req.query);
  res.json(await service.searchClinics(input));
}

export async function cities(_req: Request, res: Response) {
  res.json({ cities: await service.listCities() });
}

export async function getById(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await service.getClinic(id));
}
