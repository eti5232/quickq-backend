import type { Appointment, Clinic, Provider, User } from '@prisma/client';
import { addMinutes, toLocalDateStr, toLocalTimeStr } from './time.js';

/**
 * המרת רשומות מסד הנתונים לתשובות API.
 * חשוב: passwordHash לעולם לא יוצא מכאן.
 */

export function serializeUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    nationalId: user.nationalId,
    defaultTravelMinutes: user.defaultTravelMinutes,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
    isRegistered: user.passwordHash !== null,
    clinicId: user.clinicId,
    createdAt: user.createdAt,
  };
}

export function serializeClinic(clinic: Clinic) {
  return {
    id: clinic.id,
    name: clinic.name,
    category: clinic.category,
    city: clinic.city,
    address: clinic.address,
    phone: clinic.phone,
    description: clinic.description,
    isActive: clinic.isActive,
    settings: {
      changeDeadlineHours: clinic.changeDeadlineHours,
      maxFutureAppointmentsPerProvider: clinic.maxFutureAppointmentsPerProvider,
      bookingHorizonDays: clinic.bookingHorizonDays,
    },
    createdAt: clinic.createdAt,
  };
}

export function serializeProvider(provider: Provider) {
  return {
    id: provider.id,
    clinicId: provider.clinicId,
    fullName: provider.fullName,
    specialty: provider.specialty,
    slotMinutes: provider.slotMinutes,
    isActive: provider.isActive,
  };
}

export type AppointmentWithRelations = Appointment & {
  provider: Provider & { clinic: Clinic };
  client: User;
};

const ACTIVE = new Set(['BOOKED', 'ARRIVED']);

export function serializeAppointment(
  a: AppointmentWithRelations,
  options: { includeClient: boolean; now?: Date },
) {
  const now = options.now ?? new Date();
  const deadline = addMinutes(a.startTime, -a.provider.clinic.changeDeadlineHours * 60);
  const isActive = ACTIVE.has(a.status);
  return {
    id: a.id,
    status: a.status,
    startTime: a.startTime,
    endTime: a.endTime,
    date: toLocalDateStr(a.startTime),
    time: toLocalTimeStr(a.startTime),
    queueNumber: a.queueNumber,
    source: a.source,
    notes: a.notes,
    reminderEnabled: a.reminderEnabled,
    travelMinutes: a.travelMinutes,
    effectiveTravelMinutes: a.travelMinutes ?? a.client.defaultTravelMinutes,
    reminderSentAt: a.reminderSentAt,
    isLateCancellation: a.isLateCancellation,
    arrivedAt: a.arrivedAt,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    cancelledAt: a.cancelledAt,
    changeDeadline: deadline,
    canReschedule: a.status === 'BOOKED' && now < deadline,
    canCancel: isActive && toLocalDateStr(a.startTime) >= toLocalDateStr(now),
    cancellationWouldBeLate: isActive && now >= deadline,
    provider: {
      id: a.provider.id,
      fullName: a.provider.fullName,
      specialty: a.provider.specialty,
      slotMinutes: a.provider.slotMinutes,
    },
    clinic: {
      id: a.provider.clinic.id,
      name: a.provider.clinic.name,
      city: a.provider.clinic.city,
      address: a.provider.clinic.address,
      phone: a.provider.clinic.phone,
    },
    client: options.includeClient
      ? {
          id: a.client.id,
          fullName: a.client.fullName,
          phone: a.client.phone,
          email: a.client.email,
          nationalId: a.client.nationalId,
          isRegistered: a.client.passwordHash !== null,
        }
      : undefined,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export const appointmentInclude = {
  provider: { include: { clinic: true } },
  client: true,
} as const;
