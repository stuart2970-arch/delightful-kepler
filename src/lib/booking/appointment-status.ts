/** Appointments are soft-cancelled; rows are never deleted for audit. */
export const APPOINTMENT_STATUS_BOOKED = 'booked' as const
export const APPOINTMENT_STATUS_CANCELLED = 'cancelled' as const

export type AppointmentStatus =
  | typeof APPOINTMENT_STATUS_BOOKED
  | typeof APPOINTMENT_STATUS_CANCELLED