// Cálculo dos lembretes (separado para poder testar sem servidor).

const REMIND = {
  pt: { 0: 'Começa agora', 10: '10 min antes', 30: '30 min antes', 60: '1 hora antes', 1440: '1 dia antes' },
  en: { 0: 'Starting now', 10: '10 min before', 30: '30 min before', 60: '1 hour before', 1440: '1 day before' },
};
const AT = { pt: '{t} às {h}', en: '{t} at {h}' };
const TOMORROW = { pt: 'Amanhã', en: 'Tomorrow' };

const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5);

// Partes da data/hora local num fuso horário.
export function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
// Hora local (num fuso) -> instante real.
export function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = t => { const p = localParts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
  const o1 = off(guess);
  let t = guess - o1;
  const o2 = off(t);
  if (o2 !== o1) t = guess - o2;
  return t;
}

// Mesmo cálculo de repetição do app.
export function occurs(ev, y, m, d) {
  const [sy, sm, sd] = ev.date.split('-').map(Number);
  const diff = dayNum(y, m, d) - dayNum(sy, sm, sd);
  if (diff < 0) return false;
  switch (ev.repeat) {
    case 'none': return diff === 0;
    case 'daily': return true;
    case 'weekly': return diff % 7 === 0;
    case 'biweekly': return diff % 14 === 0;
    case 'monthly': return d === sd;
  }
  return false;
}

// Os lembretes que devem sair agora para uma pessoa: os dela e os da família, nunca o privado de outra pessoa.
export function dueFor(person, events, nowMs, tz) {
  const out = [];
  const mine = events.filter(e => e.reminder >= 0 && (e.private ? e.by_person === person : (e.owner === person || e.owner === 'familia')));
  const today = localParts(nowMs, tz);
  for (let i = 0; i < 2; i++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const y = base.getUTCFullYear(), m = base.getUTCMonth() + 1, d = base.getUTCDate();
    for (const e of mine) {
      if (!occurs(e, y, m, d)) continue;
      const [h, mi] = e.start_time.split(':').map(Number);
      const start = zonedToUtc(y, m, d, h, mi, tz);
      const fire = start - e.reminder * 60000;
      // Igual ao protótipo: avisa a partir da hora do lembrete até o compromisso começar
      // (para "na hora", dá 10 minutos de margem).
      if (fire <= nowMs && nowMs < Math.max(start, fire + 10 * 60000)) {
        out.push({ event: e, occDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, tomorrow: i === 1 });
      }
    }
  }
  return out;
}

export function message(item, lang) {
  const L = lang === 'en' ? 'en' : 'pt', e = item.event;
  const title = AT[L].replace('{t}', e.title).replace('{h}', e.start_time);
  const when = REMIND[L][e.reminder] || '';
  const body = [item.tomorrow ? TOMORROW[L] : '', when, e.place].filter(Boolean).join(' · ');
  return { title, body, tag: `${e.id}-${item.occDate}`, url: `/?d=${item.occDate}` };
}
