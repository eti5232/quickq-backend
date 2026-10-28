import { prisma } from '../../db/prisma.js';
import type { CreateJoinRequestInput } from './join-requests.schemas.js';

export async function createJoinRequest(input: CreateJoinRequestInput) {
  const request = await prisma.joinRequest.create({ data: { ...input, message: input.message ?? null } });
  return {
    id: request.id,
    status: request.status,
    createdAt: request.createdAt,
    message: 'הפנייה התקבלה! ניצור איתך קשר בהקדם',
  };
}
