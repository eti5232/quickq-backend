import type { Request, Response } from 'express';
import { createJoinRequestSchema } from './join-requests.schemas.js';
import * as service from './join-requests.service.js';

export async function create(req: Request, res: Response) {
  const input = createJoinRequestSchema.parse(req.body);
  res.status(201).json(await service.createJoinRequest(input));
}
