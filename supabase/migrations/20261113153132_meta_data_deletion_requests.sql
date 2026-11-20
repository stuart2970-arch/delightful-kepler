-- Meta data-deletion callback status.
-- Stores an opaque confirmation code and its status only.
-- The Meta user id is not stored. Service role bypasses RLS; no other role can read or write.

CREATE TABLE public.meta_data_deletion_requests (
  confirmation_code text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.meta_data_deletion_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_data_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.meta_data_deletion_requests TO service_role;
