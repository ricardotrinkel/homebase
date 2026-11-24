/* Assistente grátis: entende frases simples em português, sem internet nem IA.
   Devolve o mesmo formato do servidor: { reply, actions: [...] }.
   Usado quando o assistente com IA não está ligado (sem chave) ou falhou. */
(function (g) {
  const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const SEMANA = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, primeiro: 1 };
  const MES_RE = '(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // Acha uma data na frase. Devolve { date, until, used: [trechos usados] }.
  function findDates(f, today) {
    const used = [];
    const mk = (d, m, y) => {
      let dt = new Date(y || today.getFullYear(), m - 1, d);
      if (!y && dt < today) dt = new Date(today.getFullYear() + 1, m - 1, d);
      return dt.getMonth() === m - 1 ? dt : null;
    };
    const dayOnly = d => { let dt = new Date(today.getFullYear(), today.getMonth(), d); if (dt < today) dt = new Date(today.getFullYear(), today.getMonth() + 1, d); return dt; };
    let m;
    // Intervalo: "de 20 a 27 de dezembro", "do dia 20 ao dia 27/12", "20/12 a 3/1"
    m = f.match(new RegExp(`(?:de|do dia|dia)?\\s*(\\d{1,2})(?:\\s*de\\s*${MES_RE}|\\/(\\d{1,2}))?\\s*(?:a|ate|ao|-)\\s*(?:o\\s+)?(?:dia\\s*)?(\\d{1,2})(?:\\s*de\\s*${MES_RE}|\\/(\\d{1,2}))`));
    if (m) {
      const m2 = m[5] ? MESES[m[5]] : +m[6];
      const m1 = m[2] ? MESES[m[2]] : m[3] ? +m[3] : m2;
      const a = mk(+m[1], m1), b0 = mk(+m[4], m2);
      if (a && b0) { const b = b0 < a ? new Date(b0.getFullYear() + 1, b0.getMonth(), b0.getDate()) : b0; used.push(m[0]); return { date: iso(a), until: iso(b), used }; }
    }
    // "3 de marco", "dia 3 de marco", "3/3", "3/3/2027"
    m = f.match(new RegExp(`(?:dia\\s*)?(\\d{1,2})\\s*de\\s*${MES_RE}(?:\\s*de\\s*(\\d{4}))?`)) || null;
    if (m) { const d = mk(+m[1], MESES[m[2]], m[3] ? +m[3] : 0); if (d) { used.push(m[0]); return { date: iso(d), used, year: m[3] ? +m[3] : null }; } }
    m = f.match(/(?:dia\s*)?\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; const d = mk(+m[1], +m[2], y); if (d) { used.push(m[0]); return { date: iso(d), used, year: y || null }; } }
    if ((m = f.match(/depois de amanha/))) { used.push(m[0]); const d = new Date(today); d.setDate(d.getDate() + 2); return { date: iso(d), used }; }
    if ((m = f.match(/\bamanha\b/))) { used.push(m[0]); const d = new Date(today); d.setDate(d.getDate() + 1); return { date: iso(d), used }; }
    if ((m = f.match(/\bhoje\b/))) { used.push(m[0]); return { date: iso(today), used }; }
    m = f.match(/(?:na |no |nesta |neste |proxima |proximo )?\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira| feira)?(?: que vem)?/);
    if (m) { const want = SEMANA[m[1]]; const d = new Date(today); let add = (want - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); used.push(m[0]); return { date: iso(d), used }; }
    m = f.match(/\bdia (\d{1,2})\b/);
    if (m) { used.push(m[0]); return { date: iso(dayOnly(+m[1])), used }; }
    return { date: null, used };
  }

  // Acha o horário: "15h", "15:30", "as 3 da tarde", "meio-dia"
  function findTime(f) {
    let m;
    if ((m = f.match(/meio[- ]dia/))) return { t: '12:00', used: m[0] };
    m = f.match(/(?:\bas |\ba partir das |\ba )?\b(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s*(?:h|horas?|:)\s*(\d{2})?(?:\s*(?:da|de)\s*(manha|tarde|noite))?/)
      || f.match(/\bas\s+(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s*e\s*(meia))?(?:\s*(?:da|de)\s*(manha|tarde|noite))?/);
    if (!m) return { t: null };
    let h = /\d/.test(m[1]) ? +m[1] : NUM[m[1]], min = m[2] === 'meia' ? 30 : m[2] ? +m[2] : 0;
    if ((m[3] === 'tarde' || m[3] === 'noite') && h < 12) h += 12;
    if (h > 23 || min > 59) return { t: null };
    return { t: `${pad(h)}:${pad(min)}`, used: m[0] };
  }

  const strip = (s, parts) => { let r = s; for (const p of parts) if (p) r = r.replace(p, ' '); return r; };
  const tidy = s => s.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();
  const dropLead = (s, words) => { let r = s, prev; do { prev = r; r = r.replace(new RegExp(`^(?:${words})\\b\\s*`, 'i'), ''); } while (r !== prev); return r; };
  const LEAD = 'por favor|me|pode|poderia|quero|queria|vou|vai|tenho|tem|preciso|adicion\\w*|acrescent\\w*|coloc\\w*|poe|bota|anota\\w*|marc\\w*|agend\\w*|cria\\w*|registr\\w*|lembr\\w*|salv\\w*|um|uma|o|a|os|as|na|no|de|do|da|para|pra|que';

  // Devolve os acentos: troca cada palavra pela forma original que a pessoa disse.
  function accents(title, text) {
    const map = {};
    for (const w of text.toLowerCase().split(/[^\p{L}\d]+/u)) if (w && !(fold(w) in map)) map[fold(w)] = w;
    return title.split(' ').map(w => map[w] || w).join(' ');
  }
  const hasWhen = (c, today) => !!(findDates(c, today).date || findTime(c).t);
  function splitAnd(c, today) {
    if (/\b(supermercado|mercado|farmacia)\b/.test(c)) return [c];
    const re = /\s+e\s+/g; let m;
    while ((m = re.exec(c))) {
      const l = c.slice(0, m.index), r = c.slice(m.index + m[0].length);
      if (hasWhen(l, today) && hasWhen(r, today)) return [l, ...splitAnd(r, today)];
    }
    return [c];
  }
  function parse(text, ctx) {
    const today = ctx.today ? new Date(ctx.today + 'T00:00:00') : new Date(new Date().toDateString());
    const people = (ctx.people || []).filter(p => p.id !== 'familia');
    // Separa em pedidos: vírgula, ponto, ";" ou "e" antes de uma palavra que começa outro pedido.
    const KEY = /\b(viagem|viajar|ferias|aniversario|niver|tarefas?|supermercado|mercado|farmacia)\b/;
    const LIST = /\b(supermercado|mercado|farmacia)\b/;
    const parts = fold(text).replace(/\s+e\s+(?=(?:tambem\s+)?(?:a |o |uma? )?(?:viagem|aniversario|niver|compromisso|tarefa|consulta|reuniao|marca|adiciona|coloca|poe|lembra|agenda)\b)/g, ';')
      .split(/[;,.\n]/).map(s => s.trim()).filter(Boolean);
    // Junta "banana, maçã e arroz no mercado" de volta numa frase só.
    const clauses = [];
    for (let i = 0; i < parts.length; i++) {
      let c = parts[i];
      if (!KEY.test(c) && !hasWhen(c, today)) {
        let j = i; while (j + 1 < parts.length && !KEY.test(parts[j + 1]) && !hasWhen(parts[j + 1], today)) j++;
        if (j + 1 < parts.length && LIST.test(parts[j + 1]) && !hasWhen(parts[j + 1], today)) { c = parts.slice(i, j + 2).join(', '); i = j + 1; }
      }
      clauses.push(...splitAnd(c, today));
    }
    const actions = [], missed = [];
    const base = { date: null, until: null, start: null, end: null, repeat: 'none', owner: null, list: null, vis: null, year: null, place: null };
    const whoIn = f => { if (/\bfamilia\b/.test(f)) return 'familia'; const p = people.find(x => new RegExp(`\\b${fold(x.name)}\\b`).test(f)); return p ? p.id : null; };
    let lastList = null;
    for (const c of clauses) {
      // Listas: "leite e pão no mercado", "dipirona na farmácia"
      const lm = c.match(/(?:(?:na|no|pra|para|a|da|do)\s+)?(?:lista\s+(?:do|da|de)\s+)?(supermercado|mercado|farmacia)\b/) || (lastList && !/aniversario|niver|viagem|viajar|\d/.test(c) ? [null, lastList] : null);
      if (lm) {
        const list = lm[1] === 'farmacia' ? 'farmacia' : 'mercado'; lastList = lm[1];
        let rest = lm[0] ? c.replace(lm[0], ' ') : c;
        rest = dropLead(tidy(rest.replace(/\blista\b/g, ' ')), LEAD + '|compra\\w*|comprar');
        for (const it of rest.split(/\s*,\s*|\s+e\s+/).map(x => tidy(dropLead(x, 'um|uma|o|a|os|as|de|mais'))).filter(Boolean)) actions.push({ ...base, kind: 'shopping', title: cap(accents(it, text)), list });
        continue;
      }
      if (/\b(aniversario|niver)\b/.test(c)) {
        const d = findDates(c, today);
        let name = tidy(strip(c, d.used)).replace(/.*\b(?:aniversario|niver)\b\s*/, '');
        const vis = /\b(so eu|so pra mim|so para mim|individual|privad\w*)\b/.test(c) ? 'eu' : 'familia';
        name = tidy(name.replace(/\b(so eu|so pra mim|so para mim|individual|privad\w*|pra familia toda|para a familia|familia toda)\b/g, ' '));
        name = tidy(dropLead(name, 'da|do|de|dele|dela|e|eh|vai ser|sera|no|na|dia|em'));
        for (let k = 0; k < 4; k++) name = name.replace(/\s+(?:e|eh|vai ser|sera|no|na|dia|em|que|de|do|da)\s*$/, '').trim();
        if (!name || !d.date) { missed.push(c); continue; }
        const nm = accents(name, text).split(' ').map(cap).join(' ');
        actions.push({ ...base, kind: 'birthday', title: nm, date: d.date, vis, year: d.year || null });
        continue;
      }
      if (/\b(viagem|viajar|viajo|viajamos|ferias)\b/.test(c)) {
        const d = findDates(c, today);
        let title = tidy(strip(c, d.used)).replace(/.*?\b(?:viagem|viajar|viajo|viajamos|ferias)\b\s*/, '');
        title = tidy(dropLead(title, 'para|pra|pro|a|o|de|do|da|em|no|na'));
        title = title.replace(/\b(com a familia|da familia|familia toda)\b/g, ' ').trim();
        if (!d.date) { missed.push(c); continue; }
        actions.push({ ...base, kind: 'trip', title: cap(accents(tidy(title), text) || 'Viagem'), date: d.date, until: d.until || d.date, owner: whoIn(c) || 'familia' });
        continue;
      }
      if (/\b(tarefa|tarefas|to-?do)\b/.test(c)) {
        const t = tidy(dropLead(tidy(c.replace(/.*\b(?:tarefas?|to-?do)\b\s*/, '')), LEAD + '|minhas|minha'));
        if (t) actions.push({ ...base, kind: 'todo', title: cap(accents(t, text)) }); else missed.push(c);
        continue;
      }
      const d = findDates(c, today), tm = findTime(c);
      if (d.date || tm.t) {
        let repeat = 'none';
        if (/\btodo dia\b|\btodos os dias\b|\bdiariamente\b/.test(c)) repeat = 'daily';
        else if (/\btoda (segunda|terca|quarta|quinta|sexta)|\btodo (sabado|domingo)|\btoda semana\b|\bsemanal\b/.test(c)) repeat = 'weekly';
        else if (/\btodo mes\b|\bmensal\b/.test(c)) repeat = 'monthly';
        let title = tidy(strip(c, [tm.used, ...d.used]).replace(/\b(todo dia|todos os dias|diariamente|toda semana|semanal|todo mes|mensal|toda|todo|da familia|familia toda|com a familia)\b/g, ' '));
        title = tidy(dropLead(title, LEAD + '|compromisso|evento'));
        const who = whoIn(c);
        if (who && who !== 'familia') { const p = people.find(x => x.id === who); title = tidy(title.replace(new RegExp(`\\b(?:da|do|de|pra|para|com)?\\s*${fold(p.name)}\\b`), ' ')); }
        title = title.replace(/\s+(?:as|a|no|na|de|do|da|em|para|pra)$/, '').trim();
        if (!d.date || !title) { missed.push(c); continue; }
        actions.push({ ...base, kind: 'event', title: cap(accents(title, text)), date: d.date, start: tm.t || '09:00', repeat, owner: who });
        continue;
      }
      missed.push(c);
    }
    const n = actions.length;
    const reply = n ? `Entendi ${n === 1 ? '1 coisa' : n + ' coisas'}.${missed.length ? ' Não entendi: “' + missed.join('”, “') + '”.' : ''}`
      : 'Não entendi. Tente assim: “leite no mercado”, “aniversário da Ana dia 3 de março”, “dentista amanhã às 15h”, “viagem para a praia de 20 a 27 de dezembro”.';
    return { reply, actions };
  }
  g.localVoice = parse;
})(typeof window !== 'undefined' ? window : globalThis);
