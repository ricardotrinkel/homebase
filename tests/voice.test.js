import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../voice-local.js';

const ctx = { today: '2026-11-24', people: [{ id: 'ana', name: 'Ana', role: 'Mãe' }, { id: 'gabi', name: 'Gabi', role: 'Filha' }] };
const run = t => globalThis.localVoice(t, ctx).actions;
const pick = (a, ...k) => Object.fromEntries(k.map(x => [x, a[x]]));

test('lista do mercado com vários itens', () => {
  const a = run('põe leite e pão na lista do mercado');
  assert.deepEqual(a.map(x => [x.kind, x.title, x.list]), [['shopping', 'Leite', 'mercado'], ['shopping', 'Pão', 'mercado']]);
});
test('farmácia', () => {
  assert.deepEqual(run('dipirona na farmácia').map(x => [x.title, x.list]), [['Dipirona', 'farmacia']]);
});
test('aniversário com mês por extenso', () => {
  const [a] = run('aniversário da vó Maria dia 3 de março');
  assert.deepEqual(pick(a, 'kind', 'title', 'date', 'vis'), { kind: 'birthday', title: 'Vó Maria', date: '2027-03-03', vis: 'familia' });
});
test('aniversário só pra mim', () => {
  const [a] = run('adiciona o aniversário da Luana em 1/2 só pra mim');
  assert.deepEqual(pick(a, 'title', 'date', 'vis'), { title: 'Luana', date: '2027-02-01', vis: 'eu' });
});
test('viagem com intervalo', () => {
  const [a] = run('viagem para a praia de 20 a 27 de dezembro');
  assert.deepEqual(pick(a, 'kind', 'title', 'date', 'until', 'owner'), { kind: 'trip', title: 'Praia', date: '2026-12-20', until: '2026-12-27', owner: 'familia' });
});
test('viagem virando o ano', () => {
  const [a] = run('viagem pra Bahia de 28 de dezembro a 4 de janeiro');
  assert.deepEqual(pick(a, 'date', 'until'), { date: '2026-12-28', until: '2027-01-04' });
});
test('compromisso amanhã com hora', () => {
  const [a] = run('dentista amanhã às 15h');
  assert.deepEqual(pick(a, 'kind', 'title', 'date', 'start'), { kind: 'event', title: 'Dentista', date: '2026-11-25', start: '15:00' });
});
test('compromisso na quinta à tarde, de outra pessoa', () => {
  const [a] = run('marca natação da Gabi quinta às 4 da tarde');
  assert.deepEqual(pick(a, 'title', 'date', 'start', 'owner'), { title: 'Natação', date: '2026-11-26', start: '16:00', owner: 'gabi' });
});
test('vários pedidos de uma vez', () => {
  const a = run('viagem pra praia de 20 a 27 de dezembro, leite no mercado, aniversário da vó dia 3 de março e dentista quinta 15h');
  assert.deepEqual(a.map(x => x.kind), ['trip', 'shopping', 'birthday', 'event']);
  assert.equal(a[3].title, 'Dentista');
  assert.deepEqual(run('viagem pra praia de 20 a 27 de dezembro, leite no mercado, aniversário da vó maria 3 de março, dentista quinta 15h').map(x => x.title), ['Praia', 'Leite', 'Vó Maria', 'Dentista']);
  assert.deepEqual(run('Coloca banana, maçã e arroz no supermercado').map(x => x.title), ['Banana', 'Maçã', 'Arroz']);
});
test('tarefa', () => {
  assert.deepEqual(run('tarefa estudar para a prova').map(x => [x.kind, x.title]), [['todo', 'Estudar para a prova']]);
});
test('sem data não inventa', () => {
  const r = globalThis.localVoice('aniversário da Ana', ctx);
  assert.equal(r.actions.length, 0);
  assert.match(r.reply, /Não entendi/);
});
test('viagem do dia X ao dia Y para várias pessoas (nomes falados diferente)', () => {
  const c = { today: '2026-11-24', people: [{ id: 'isa', name: 'isa' }, { id: 'lili', name: 'Lili' }, { id: 'frieda', name: 'Frieda' }] };
  const a = globalThis.localVoice('adicione uma viagem do dia 3 ao dia 6 de dezembro a São Paulo para Isabela, Liliane e Frida', c).actions;
  assert.deepEqual(a.map(x => [x.kind, x.title, x.date, x.until, x.owner]), ['isa', 'lili', 'frieda'].map(o => ['trip', 'São Paulo', '2026-12-03', '2026-12-06', o]));
  const [b] = globalThis.localVoice('viagem do dia três ao dia seis de dezembro para o Rio de Janeiro', c).actions;
  assert.deepEqual([b.title, b.date, b.until], ['Rio de Janeiro', '2026-12-03', '2026-12-06']);
});
