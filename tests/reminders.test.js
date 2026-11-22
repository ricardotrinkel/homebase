import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueFor, zonedToUtc, message } from '../api/_reminders.js';

const TZ = 'America/Sao_Paulo';
const ev = (o) => ({ id: 'e1', owner: 'marina', by_person: 'marina', title: 'Inglês', date: '2026-11-23', start_time: '15:00', repeat: 'none', reminder: 30, place: '', private: false, ...o });
const at = (s) => zonedToUtc(...s.split(/[-T:]/).map(Number), TZ);

test('converte hora local de São Paulo (UTC-3)', () => {
  assert.equal(new Date(at('2026-11-23T15:00')).toISOString(), '2026-11-23T18:00:00.000Z');
});
test('30 min antes: dispara às 14:30, não às 14:29', () => {
  assert.equal(dueFor('marina', [ev()], at('2026-11-23T14:29'), TZ).length, 0);
  assert.equal(dueFor('marina', [ev()], at('2026-11-23T14:30'), TZ).length, 1);
  assert.equal(dueFor('marina', [ev()], at('2026-11-23T15:00'), TZ).length, 0);
});
test('só para a dona, família para todos, privado só para quem marcou', () => {
  const now = at('2026-11-23T14:45');
  assert.equal(dueFor('gabi', [ev()], now, TZ).length, 0);
  assert.equal(dueFor('gabi', [ev({ owner: 'familia' })], now, TZ).length, 1);
  assert.equal(dueFor('liliane', [ev()], now, TZ).length, 0); // admin não recebe aviso dos outros
  assert.equal(dueFor('marina', [ev({ private: true })], now, TZ).length, 1);
  assert.equal(dueFor('isa', [ev({ owner: 'familia', private: true })], now, TZ).length, 0);
});
test('1 dia antes e repetição semanal / 15 dias / mensal', () => {
  assert.equal(dueFor('marina', [ev({ reminder: 1440 })], at('2026-11-22T15:00'), TZ)[0].tomorrow, true);
  assert.equal(dueFor('marina', [ev({ repeat: 'weekly' })], at('2026-11-30T14:40'), TZ).length, 1);
  assert.equal(dueFor('marina', [ev({ repeat: 'biweekly' })], at('2026-11-30T14:40'), TZ).length, 0);
  assert.equal(dueFor('marina', [ev({ repeat: 'biweekly' })], at('2026-12-07T14:40'), TZ).length, 1);
  assert.equal(dueFor('marina', [ev({ repeat: 'monthly' })], at('2026-12-23T14:40'), TZ).length, 1);
});
test('sem lembrete e na hora', () => {
  assert.equal(dueFor('marina', [ev({ reminder: -1 })], at('2026-11-23T14:59'), TZ).length, 0);
  assert.equal(dueFor('marina', [ev({ reminder: 0 })], at('2026-11-23T15:05'), TZ).length, 1);
});
test('texto da notificação em PT e EN', () => {
  const [item] = dueFor('marina', [ev({ place: 'Escola' })], at('2026-11-23T14:31'), TZ);
  assert.deepEqual(message(item, 'pt'), { title: 'Inglês às 15:00', body: '30 min antes · Escola', tag: 'e1-2026-11-23', url: '/?d=2026-11-23' });
  assert.equal(message(item, 'en').title, 'Inglês at 15:00');
});
test('repete até: para depois da data final', () => {
  const e = ev({ repeat: 'weekly', until: '2026-12-07' });
  assert.equal(dueFor('marina', [e], at('2026-12-07T14:40'), TZ).length, 1);
  assert.equal(dueFor('marina', [e], at('2026-12-14T14:40'), TZ).length, 0);
});
