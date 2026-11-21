// Envia as notificações de lembrete. É chamado a cada minuto pelo agendador do Supabase (pg_cron).
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { dueFor, message } from './_reminders.js';

export default async function handler(req, res) {
  const env = process.env;
  const secret = env.CRON_SECRET;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.query && req.query.key);
  if (!secret || given !== secret) return res.status(401).json({ error: 'unauthorized' });

  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'missing configuration' });

  webpush.setVapidDetails(env.VAPID_SUBJECT || `https://${req.headers.host}`, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const db = createClient(url, key, { auth: { persistSession: false } });

  const [{ data: subs, error: e1 }, { data: events, error: e2 }] = await Promise.all([
    db.from('push_subscriptions').select('*'),
    db.from('events').select('id,owner,by_person,title,date,start_time,repeat,reminder,place,private').gte('reminder', 0),
  ]);
  if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });

  const now = Date.now();
  const byPerson = {};
  for (const s of subs) (byPerson[s.person] ||= []).push(s);

  let sent = 0, removed = 0;
  for (const [person, list] of Object.entries(byPerson)) {
    const due = dueFor(person, events, now, list[0].tz || 'America/Sao_Paulo');
    for (const item of due) {
      // Marca como enviado; se já estava marcado, pula (evita aviso repetido).
      const { data: ins, error } = await db.from('reminders_sent')
        .upsert({ event_id: item.event.id, occ_date: item.occDate, person }, { onConflict: 'event_id,occ_date,person', ignoreDuplicates: true })
        .select();
      if (error || !ins || !ins.length) continue;
      for (const s of list) {
        const msg = message(item, s.lang);
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 3600, urgency: 'high' });
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
            removed++;
          } else console.error('push failed', err.statusCode, err.body);
        }
      }
    }
  }
  // Limpeza: esquece lembretes enviados há mais de 3 dias.
  await db.from('reminders_sent').delete().lt('sent_at', new Date(now - 3 * 864e5).toISOString());
  res.status(200).json({ ok: true, sent, removed });
}
