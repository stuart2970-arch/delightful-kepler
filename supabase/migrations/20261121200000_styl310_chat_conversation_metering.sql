-- STYL-310: Idempotent chat conversation consumption rows (one ledger unit per conversation).
-- Rollback: DROP INDEX IF EXISTS usage_ledger_chat_conversation_key;

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_chat_conversation_key
  ON public.usage_ledger (tenant_id, sector_tag)
  WHERE usage_type = 'consumption' AND sector_tag LIKE 'chat_conversation:%';