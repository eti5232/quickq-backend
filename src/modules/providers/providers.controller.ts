import type { Request, Response } from 'express';
import { idParam } from '../../utils/validation.js';
import { getFreeSlots, getMonthAvailability } from '../../services/scheduling.service.js';
import { getLiveStatus } from '../../services/queue.service.js';
import { availabilityQuery, slotsQuery } from './providers.schemas.js';

export async function availability(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { month } = availabilityQuery.parse(req.query);
  res.json(await getMonthAvailability(id, month));
}

export async function slots(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { date } = slotsQuery.parse(req.query);
  res.json(await getFreeSlots(id, date));
}

export async function live(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const viewer = req.user ? { id: req.user.id, role: req.user.role } : null;
  res.json(await getLiveStatus(id, viewer));
}
