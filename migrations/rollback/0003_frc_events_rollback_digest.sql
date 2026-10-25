-- Read only. The content of the three event tables and its digest, computed
-- exactly as 0003_frc_events_rollback.sql computes it, in one statement so the
-- saved content and the digest are the same snapshot. The saved result is the
-- export Patrick approves before a schema rollback, and the rollback runs only
-- with that digest set as frc.rollback_approved_digest in the same session.
BEGIN READ ONLY;
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, MDY';
SET LOCAL IntervalStyle = 'postgres';
SET LOCAL extra_float_digits = 1;

SELECT md5(concat_ws('|', e, s, a)) AS digest,
	e AS frc_events,
	s AS frc_event_sessions,
	a AS frc_event_audit
FROM (SELECT
	(SELECT coalesce(json_agg(t ORDER BY t.id)::text, '[]') FROM public.frc_events t) AS e,
	(SELECT coalesce(json_agg(t ORDER BY t.session_key)::text, '[]') FROM public.frc_event_sessions t) AS s,
	(SELECT coalesce(json_agg(t ORDER BY t.id)::text, '[]') FROM public.frc_event_audit t) AS a) AS content;

COMMIT;
