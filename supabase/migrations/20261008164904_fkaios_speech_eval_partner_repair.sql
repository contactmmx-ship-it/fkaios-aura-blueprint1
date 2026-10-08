-- Data repair (8 Oct 2026): the 16:46 speech evaluation of
-- gemini-2.5-flash-preview-tts failed on the partner STT leg (HTTP 503 high
-- demand on gemini-3.5-flash-lite), not on the candidate, but was recorded as
-- 'error', which holds it back for 24 h. PR #62 records such runs as
-- 'partner_unavailable' (retry after 30 min); align the existing row.
update public.fkaios_resource_capabilities
set metadata = metadata || '{"last_eval_result": "partner_unavailable"}'::jsonb, updated_at = now()
where capability = 'text_to_speech' and resource_ref = 'model:gemini:gemini-2.5-flash-preview-tts'
  and metadata->>'last_eval_result' = 'error';
