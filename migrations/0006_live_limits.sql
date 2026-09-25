-- Raise the live run limits for GPT-6 Luna.
--
-- At Luna's prices ($0.10 per million input tokens, $0.50 per million output) a
-- live goal run settles at about $0.002, so the count limits seeded by 0003 were
-- stopping visitors long before the dollar caps in app_settings would. The
-- visitor quota goes from 5 to 25 runs a day and the global cap from 50 to 150.
-- 150 runs is about $0.30 a day, under the $0.50 daily cap. It also keeps a
-- typical day under the service's own fence of 400 provider attempts a day
-- (CADENCIA_SERVICE_DAILY_ATTEMPT_CAP), since a goal run usually makes two
-- calls. The dollar caps stay as they are and still stop spending first if runs
-- cost more than expected.

UPDATE public_limits_config SET value = 25 WHERE key = 'visitor_daily_quota';
UPDATE public_limits_config SET value = 150 WHERE key = 'global_daily_cap';
