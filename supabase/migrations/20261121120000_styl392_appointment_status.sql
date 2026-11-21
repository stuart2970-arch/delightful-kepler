-- STYL-392: soft-cancel appointments when the external calendar event is removed
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'booked';

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('booked', 'cancelled'));

UPDATE public.appointments SET status = 'booked' WHERE status IS DISTINCT FROM 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_staff_status_overlap
  ON public.appointments (tenant_id, staff_id, status, start_time, end_time);

COMMENT ON COLUMN public.appointments.status IS 'booked = blocks availability; cancelled = kept for audit, slot is free';