// src/app.ts は Flue アプリの「ルート表」。ここで明示的にマウントしたものだけが HTTP で公開されます。
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Assistant } from './agents/assistant.ts';

const app = new Hono();

// 普通の Web アプリのルートも同居できる
app.get('/health', (c) => c.text('ok'));

// 本番では必ず認証を入れる（誰でも会話を読めてしまうため）
// app.use('/agents/assistant/*', async (c, next) => {
//   if (c.req.header('authorization') !== 'Bearer secret') return c.text('unauthorized', 401);
//   await next();
// });

// POST /agents/assistant/:id … メッセージを送る（202 で受け付け）
// GET  /agents/assistant/:id … 会話を読む
app.route('/agents/assistant', createAgentRouter(Assistant));

export default app;
