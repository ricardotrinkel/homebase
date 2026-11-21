-- =====================================================================
-- Homebase: agenda o envio dos lembretes (roda a cada minuto).
-- Rode DEPOIS que o app estiver publicado na Vercel.
-- Troque os dois valores marcados antes de clicar em "Run":
--   SEU-ENDERECO  -> o endereço do app (ex.: homebase-abc.vercel.app)
--   SEU-SEGREDO   -> o mesmo valor de CRON_SECRET que você colocou na Vercel
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('homebase-lembretes')
where exists (select 1 from cron.job where jobname = 'homebase-lembretes');

select cron.schedule(
  'homebase-lembretes',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://SEU-ENDERECO/api/send-reminders',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer SEU-SEGREDO"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
