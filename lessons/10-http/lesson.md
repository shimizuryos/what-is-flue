---
title: HTTP で公開する
summary: app.ts と createAgentRouter でエージェントを Web API にする
entry: src/app.ts
http: /agents/assistant
conversationId: web-1
messages:
  - こんにちは！
  - さっき何て言いましたっけ？
---

## ここまでは「flue run」、ここからは「サーバー」

これまでのレッスンは `flue run`（CLI でエージェントを 1 回動かす）と同じ方法で実行してきました。実際のプロダクトでは、エージェントを **HTTP API** として公開し、Web 画面やほかのサービスから話しかけます。

## app.ts がルート表

`src/app.ts` は Flue アプリの HTTP の入り口です。[Hono](https://hono.dev/) のアプリを `export default` します。

```ts
app.route('/agents/assistant', createAgentRouter(Assistant));
```

`createAgentRouter(Assistant)` が、1 つのエージェント用の API 一式を作ります。

| ルート | 役割 |
| --- | --- |
| `POST /:id` | メッセージを送る。**202（受け付けました）** がすぐ返る |
| `GET /:id` | 会話を読む（スナップショット / 差分 / ライブストリーム） |
| `POST /:id/abort` | 実行中の処理を止める |

`:id` が会話IDです。URL はあなたが決められます（`/api/chat` でも OK）。会話は URL ではなく **エージェント名と ID** で保存されるので、マウント先を変えても会話は失われません。

## 試してみよう

このレッスンでは、実行ボタンを押すと次のことが起きます。

1. `app.ts` を読み込み、`'use agent'` の付いたエージェントを登録する
2. `POST /agents/assistant/web-1` に `{ "kind": "user", "body": "こんにちは！" }` を送る → **202** と `submissionId` が返る
3. 返答が終わるのを待ってから `GET /agents/assistant/web-1` で会話を読む

結果の 🌐 **HTTP** 欄で、実際のリクエストとレスポンスの JSON を確認してください。POST は「受け付けた」だけで、返答そのものは GET で会話を読んで取り出すことが分かります（Fire-and-forget）。

## 本物のプロジェクトでは

```bash
npm install @flue/runtime @flue/cli @flue/vite hono vite
npx vite dev     # http://localhost:5173 で app.ts が動く
npx vite build   # Node.js 用の dist/server.mjs や Cloudflare Worker を生成
```

クライアントからは [Flue Agent SDK](https://flueframework.com/docs/sdk/overview/)（`@flue/sdk`）や React 用の `@flue/react` を使うと、送信・待機・ストリーミングを簡単に扱えます。

```ts
const conversation = createFlueClient({ url: '/agents/assistant/web-1' });
const admission = await conversation.send({ message: { kind: 'user', body: 'こんにちは' } });
const reply = await conversation.read(admission);
```

⚠️ `createAgentRouter` には認証がありません。**URL に届く人は誰でも会話を読めます**。`app.ts` でミドルウェアを使い、「誰か」「その会話にアクセスしてよいか」を必ず確認しましょう。

## やってみよう

1. マウント先を `/api/chat` に変える（上部の **マウント先** 欄も同じ値に変更して実行）
2. コメントアウトされた認証ミドルウェアを有効にして実行し、POST が 401 になるのを確認する
3. Webhook を受けてエージェントに渡す `app.post('/webhooks/demo', ...)` を、`dispatch()` を使って書いてみる（[ドキュメント](https://flueframework.com/docs/guide/building-agents/#dispatch)）
