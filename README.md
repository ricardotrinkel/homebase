# Homebase

A agenda da família: compromissos, aniversários e listas, sincronizados entre todos os aparelhos,
com notificações de lembrete mesmo com o app fechado.

- **App:** PWA (instala na tela inicial do iPhone, iPad, Android e computador). Arquivos `index.html`, `style.css`, `app.js`, `backend.js`, `sw.js`.
- **Servidor e banco:** [Supabase](https://supabase.com) (login, banco de dados, sincronização ao vivo). Estrutura em `supabase/setup.sql`.
- **Hospedagem:** [Vercel](https://vercel.com) (publica o app e roda as funções em `api/`).
- **Lembretes:** o Supabase chama `api/send-reminders` a cada minuto (`supabase/cron.sql`), que envia as notificações push.

## Regras de quem vê o quê

As regras ficam no banco (não só no app), então valem em qualquer aparelho:

- Liliane e Isa são admins: veem e editam o horário de todos.
- As outras pessoas veem e editam só o próprio horário, mais os compromissos da família.
- "Só para mim": só quem marcou vê, nem as admins.
- Aniversário da família: todos veem. Individual: só quem criou, ou quem criou + pessoas escolhidas.
- Supermercado e Farmácia: a família toda vê e edita. Minhas tarefas: só a própria pessoa.

## Variáveis na Vercel (Settings → Environment Variables)

| Nome | O que é |
| --- | --- |
| `SUPABASE_URL` | Endereço do projeto no Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública do Supabase (publishable ou anon) |
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase (secret ou service_role). Nunca compartilhe. |
| `VAPID_PUBLIC_KEY` | Chave pública das notificações |
| `VAPID_PRIVATE_KEY` | Chave privada das notificações. Nunca compartilhe. |
| `VAPID_SUBJECT` | Opcional: `mailto:` com um email de contato. Sem ele, usa o endereço do app. |
| `CRON_SECRET` | Senha que só o agendador do Supabase conhece |

Para gerar novas chaves de notificação: `npx web-push generate-vapid-keys`.

## Testes

```
npm install
npm test
```
