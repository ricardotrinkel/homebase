/* Homebase — ligação com o servidor (Supabase).
   O resto do app (app.js) trabalha com o objeto `db` em memória, igual ao protótipo.
   Este arquivo: carrega os dados do servidor para o `db`, envia as mudanças de volta,
   escuta mudanças feitas em outros aparelhos e cuida do login e das notificações. */
window.HB = (() => {
  const CFG_LS = 'homebase-config', CACHE_LS = 'homebase-cache';
  let sb = null, cfg = null, user = null, isOffline = false, isRecovery = false, family = null, needFamily = false;
  let synced = {}, queue = Promise.resolve(), pending = false, channel = null, pushOn = false;

  /* ---------- tabelas: como cada item do app vira uma linha no banco ---------- */
  const T = {
    events: {
      get: () => db.events,
      set: rows => { db.events = rows.map(r => ({ id: r.id, owner: r.owner, by: r.by_person, title: r.title, date: r.date, start: r.start_time, end: r.end_time, repeat: r.repeat, reminder: r.reminder, place: r.place, notes: r.notes, private: r.private })); },
      to: e => ({ id: e.id, owner: e.owner, by_person: e.by || e.owner, title: e.title, date: e.date, start_time: e.start, end_time: e.end, repeat: e.repeat, reminder: +e.reminder, place: e.place || '', notes: e.notes || '', private: !!e.private }),
    },
    birthdays: {
      get: () => db.birthdays,
      set: rows => { db.birthdays = rows.map(r => ({ id: r.id, name: r.name, md: r.md, year: r.year, by: r.by_person, vis: r.vis, with: r.with_people || [] })); },
      to: b => ({ id: b.id, name: b.name, md: b.md, year: b.year || null, by_person: b.by, vis: b.vis, with_people: b.with || [] }),
    },
    list_items: {
      order: 'created_at',
      get: () => [...db.lists.mercado.map(i => ({ ...i, list: 'mercado' })), ...db.lists.farmacia.map(i => ({ ...i, list: 'farmacia' }))],
      set: rows => {
        const m = r => ({ id: r.id, text: r.text, by: r.by_person, done: r.done });
        db.lists = { mercado: rows.filter(r => r.list === 'mercado').map(m), farmacia: rows.filter(r => r.list === 'farmacia').map(m) };
      },
      to: i => ({ id: i.id, list: i.list, text: i.text, by_person: i.by, done: !!i.done }),
    },
    todos: {
      order: 'created_at',
      get: () => db.todos[db.session] || [],
      set: rows => { db.todos = { [db.session]: rows.map(r => ({ id: r.id, text: r.text, by: db.session, done: r.done })) }; },
      to: i => ({ id: i.id, text: i.text, done: !!i.done }),
    },
  };
  const NAMES = Object.keys(T);
  const snap = n => new Map(T[n].get().map(x => { const r = T[n].to(x); return [r.id, JSON.stringify(r)]; }));

  /* ---------- carregar ---------- */
  async function loadTable(n) {
    let q = sb.from(n).select('*');
    if (T[n].order) q = q.order(T[n].order);
    const { data, error } = await q;
    if (error) throw error;
    T[n].set(data);
    synced[n] = snap(n);
  }
  // A família e as pessoas dela.
  async function loadFamily(resetFilter) {
    const [{ data: f, error: e1 }, { data: ms, error: e2 }] = await Promise.all([
      sb.from('families').select('*').maybeSingle(),
      sb.from('members').select('*').order('created_at'),
    ]);
    if (e1 || e2) throw (e1 || e2);
    family = f;
    if (f) db.prefs.appIcon = f.app_icon;
    setPeople(ms || [], resetFilter);
  }
  async function loadAll(resetFilter) {
    await loadFamily(resetFilter);
    await Promise.all(NAMES.map(loadTable));
    isOffline = false;
    writeCache();
  }
  function writeCache() {
    try { localStorage.setItem(CACHE_LS, JSON.stringify({ uid: user && user.id, session: db.session, family, people: PEOPLE.map(p => ({ ...p, is_admin: p.admin })), events: db.events, birthdays: db.birthdays, lists: db.lists, todos: db.todos })); } catch (e) {}
  }
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_LS) || 'null');
      if (!c || !user || c.uid !== user.id) return false;
      if (!c.family || !c.people) return false;
      family = c.family; db.prefs.appIcon = c.family.app_icon; setPeople(c.people, true);
      Object.assign(db, { session: c.session, events: c.events, birthdays: c.birthdays, lists: c.lists, todos: c.todos });
      NAMES.forEach(n => { synced[n] = snap(n); });
      return true;
    } catch (e) { return false; }
  }

  /* ---------- enviar mudanças: compara o `db` com o que o servidor já tem ---------- */
  function push() {
    if (!sb || !db.session) return;
    queue = queue.then(async () => {
      for (const n of NAMES) {
        const now = snap(n), before = synced[n] || new Map();
        const up = [], del = [];
        now.forEach((v, id) => { if (before.get(id) !== v) up.push(JSON.parse(v)); });
        before.forEach((_, id) => { if (!now.has(id)) del.push(id); });
        if (!up.length && !del.length) continue;
        try {
          if (up.length) { const { error } = await sb.from(n).upsert(up); if (error) throw error; }
          if (del.length) { const { error } = await sb.from(n).delete().in('id', del); if (error) throw error; }
          synced[n] = now;
        } catch (e) {
          console.error('Homebase: falha ao salvar', n, e);
          toast(t('Não deu para salvar. Verifique a internet e tente de novo.'), '#EA5E86');
          try { await loadTable(n); } catch (e2) {}
          changed();
        }
      }
      writeCache();
    });
    return queue;
  }

  /* ---------- mudanças vindas de outros aparelhos ---------- */
  const timers = {};
  function reload(n) {
    clearTimeout(timers[n]);
    timers[n] = setTimeout(() => {
      queue = queue.then(async () => {
        try { n === 'family' ? await loadFamily() : await loadTable(n); writeCache(); changed(); } catch (e) {}
      });
    }, 250);
  }
  function changed() { pending = true; flush(); }
  function flush() { if (pending && api.onRemoteChange && api.onRemoteChange() !== false) pending = false; }
  function listen() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('homebase');
    NAMES.forEach(n => channel.on('postgres_changes', { event: '*', schema: 'public', table: n }, () => reload(n)));
    ['families', 'members'].forEach(n => channel.on('postgres_changes', { event: '*', schema: 'public', table: n }, () => reload('family')));
    channel.subscribe();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sb && db.session) {
      queue = queue.then(async () => { try { await loadAll(); changed(); } catch (e) {} });
    }
  });

  /* ---------- login ---------- */
  async function myMember() {
    const { data, error } = await sb.from('members').select('id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data && data.id;
  }
  async function start(memberId) {
    needFamily = false;
    db.session = memberId;
    await loadAll(true);
    listen();
    refreshPush();
  }
  // Entra com email e senha; se ainda não existe conta com esse email, cria.
  async function signIn(email, password) {
    try {
      let { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/confirm/i.test(error.message)) return { err: 'confirm' };
        if (!/invalid/i.test(error.message)) return { err: 'net' };
        const r = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
        if (r.error) return { err: /already|registered|exists/i.test(r.error.message) ? 'mismatch' : /password/i.test(r.error.message) ? 'weak' : 'net' };
        if (!r.data.session) return { err: 'confirm' };
        // Email já cadastrado com outra senha: o Supabase devolve um usuário sem identidades.
        if (r.data.user && Array.isArray(r.data.user.identities) && !r.data.user.identities.length) return { err: 'mismatch' };
        data = r.data;
      }
      user = data.user;
      const m = await myMember();
      if (m) await start(m); else { needFamily = true; db.session = null; }
      return { ok: true };
    } catch (e) {
      console.error(e);
      return { err: 'net' };
    }
  }
  const rpcErr = e => { const m = (e && e.message) || ''; return (m.match(/family_exists|short_code|not_found|taken|already_member|not_owner/) || ['net'])[0]; };
  async function createFamily(name, code, myName, role, color) {
    const { data, error } = await sb.rpc('create_family', { fname: name.trim(), fcode: code.trim(), my_name: myName.trim(), my_role: role, my_color: color });
    if (error) return { err: rpcErr(error) };
    try { await start(data); } catch (e) { return { err: 'net' }; }
    return { ok: true };
  }
  async function findFamily(name, code) {
    const { data, error } = await sb.rpc('find_family', { fname: name.trim(), fcode: code.trim() });
    if (error) return { err: rpcErr(error) };
    return data;
  }
  async function joinFamily(name, code, claimId, myName, role, color) {
    const { data, error } = await sb.rpc('join_family', { fname: name.trim(), fcode: code.trim(), claim_id: claimId, my_name: (myName || '').trim(), my_role: role, my_color: color });
    if (error) return { err: rpcErr(error) };
    try { await start(data); } catch (e) { return { err: 'net' }; }
    return { ok: true };
  }
  async function setAdmin(id, on) {
    const { error } = await sb.rpc('set_admin', { member_id: id, make_admin: on });
    if (error) return false;
    await loadFamily(); changed();
    return true;
  }
  async function setCode(code) {
    const { error } = await sb.rpc('set_family_code', { new_code: code });
    if (error) return { err: rpcErr(error) };
    await loadFamily(); writeCache();
    return { ok: true };
  }
  async function signOut() {
    try { await disablePush(); } catch (e) {}
    try { if (channel) sb.removeChannel(channel); channel = null; await sb.auth.signOut(); } catch (e) {}
    try { localStorage.removeItem(CACHE_LS); } catch (e) {}
    user = null; db.session = null; synced = {}; family = null; needFamily = false; setPeople([], true);
    Object.assign(db, { events: [], birthdays: [], lists: { mercado: [], farmacia: [] }, todos: {} });
  }
  async function forgot(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    return !error;
  }
  async function setPassword(pw) {
    const { error } = await sb.auth.updateUser({ password: pw });
    isRecovery = false;
    return !error;
  }

  /* ---------- abrir o app ---------- */
  async function boot() {
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (r.ok) { cfg = await r.json(); localStorage.setItem(CFG_LS, JSON.stringify(cfg)); }
    } catch (e) {}
    if (!cfg || !cfg.supabaseUrl) { try { cfg = JSON.parse(localStorage.getItem(CFG_LS) || 'null'); } catch (e) {} }
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseKey) return false;

    sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') isRecovery = true; });
    if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('/sw.js'); } catch (e) {} }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return true;
    user = session.user;
    const hadCache = readCache();
    try {
      const m = await myMember();
      if (!m) { needFamily = true; db.session = null; return true; }
      await start(m);
    } catch (e) {
      // Sem internet: usa o que ficou salvo neste aparelho.
      isOffline = hadCache;
      if (!hadCache) db.session = null;
    }
    return true;
  }

  /* ---------- ícone do app (só admins) ---------- */
  async function setAppIcon(i) {
    const { error } = await sb.from('families').update({ app_icon: i }).eq('id', family && family.id);
    if (error) { toast(t('Não deu para salvar. Verifique a internet e tente de novo.'), '#EA5E86'); loadFamily().then(changed); }
  }

  /* ---------- notificações push ---------- */
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function pushState() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) return isIOS() && !standalone() ? 'install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && pushOn) return 'on';
    return 'off';
  }
  const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
  async function saveSub(sub) {
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo', lang: LANG,
    }, { onConflict: 'endpoint' });
    if (error) throw error;
  }
  async function enablePush() {
    const s = pushState();
    if (s === 'install' || s === 'unsupported' || s === 'denied') return s;
    if (!cfg.vapidPublicKey) return 'unsupported';
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return pushState();
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.vapidPublicKey) }));
      await saveSub(sub);
      pushOn = true;
      return 'ok';
    } catch (e) {
      console.error('Homebase: push', e);
      return 'error';
    }
  }
  async function disablePush() {
    pushOn = false;
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (e) {}
    try { await sub.unsubscribe(); } catch (e) {}
  }
  // Ao abrir o app: se a pessoa já tinha permitido, renova a inscrição (e o idioma) sem perguntar de novo.
  async function refreshPush() {
    if (!db.prefs.notif || pushState() === 'install' || pushState() === 'unsupported') return;
    if (Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (cfg.vapidPublicKey && (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.vapidPublicKey) })));
      if (sub) { await saveSub(sub); pushOn = true; changed(); }
    } catch (e) { console.error('Homebase: push', e); }
  }

  const api = {
    boot, signIn, signOut, forgot, setPassword, push, flush, setAppIcon,
    createFamily, findFamily, joinFamily, setAdmin, setCode,
    needsFamily: () => needFamily,
    family: () => family,
    isOwner: () => !!(family && family.owner_member === db.session),
    enablePush, disablePush, refreshPush, pushState,
    email: () => (user && user.email) || '',
    offline: () => isOffline,
    recovery: () => isRecovery,
    onRemoteChange: null,
  };
  return api;
})();
