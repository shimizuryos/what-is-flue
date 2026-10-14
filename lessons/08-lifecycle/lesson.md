---
title: 初期データとイベントフック
summary: useInitialData・useAgentStart・useResponseStart/Finish でライフサイクルに処理を差し込む
entry: src/agents/account-support.ts
conversationId: account-1
initialData: '{"customerId": "C-42"}'
messages:
  - 私のプランを教えて
  - プランを変更したいです
---

## 会話に「最初のデータ」を渡す：useInitialData

会話を作るときに、構造化されたデータを渡せます。ID に情報を詰め込むより安全で分かりやすい方法です。

```ts
const initial = useInitialData<{ customerId: string }>();

// エージェントの static にスキーマを書くと、会話作成時に検証される
AccountSupport.initialData = v.object({ customerId: v.string() });
```

渡し方はどの呼び出し方法でも同じです。

```bash
npx flue run src/agents/account-support.ts --id account-1 --data '{"customerId":"C-42"}' --message "..."
```

```ts
await dispatch(AccountSupport, { id: 'account-1', initialData: { customerId: 'C-42' }, message: '...' });
```

⚠️ initialData が使われるのは **会話が新しく作られるときだけ** です。既にある会話に別のデータを送っても無視されます。上の **初期データ (JSON)** 欄を `C-77` に変えて試すときは、会話IDも変えてください。

## イベントフック：ライフサイクルに処理を差し込む

| フック | いつ動く？ | 主な用途 |
| --- | --- | --- |
| `useAgentStart(async ctx => …)` | メッセージが届くたび、モデルが動く前 | データの読み込み、ファイルの準備 |
| `useAgentFinish(async ctx => …)` | モデルが返答を終えようとしたとき | 仕事が終わったか確認し、まだならやり直させる |
| `useResponseStart(ctx => …)` | 返答の最初に 1 回 | 返答のメタデータ（開始時刻など） |
| `useResponseFinish(ctx => …)` | 返答の最後に 1 回 | トークン数・所要時間などのメタデータ |

このレッスンのコードでは、

1. `useAgentStart` で CRM から顧客情報を読み、`usePersistentState` に保存
2. 同時に `append()` で「顧客情報を読み込んだ」という **シグナル** を会話に追加
3. `useResponseStart` / `useResponseFinish` で所要時間とトークン数を返答の **メタデータ** に記録

しています。

## 大事なタイミングの話

エージェント関数（レンダー）は `useAgentStart` を見つけるために **先に** 実行されます。そのため、`useAgentStart` の中で書いた状態は **次のレンダーから** 見えます。ツールを呼ばない返答では、最初のモデル呼び出しの指示文には間に合いません。

そこで、この返答のモデルにもすぐ伝えたい情報は `append({ kind: 'signal', ... })` でシグナルとして会話に入れます。🔍 で見ると、ユーザーのメッセージの直後に `<signal type="crm.customer-loaded">` が入っているはずです。

2 通目以降は、状態から組み立てた指示文（「山田 花子 様（Pro プラン）…」）がシステムプロンプトに入ります。指示文が変わったことは `<signal type="instructions">` でモデルに自動通知されます。

## 試してみよう

1. 「私のプランを教えて」を送る
2. ログ欄の `[render]` は「未読み込み」、その後に `useAgentStart` のログが出る順番を確認
3. 🔍 で、ユーザーのメッセージの後ろに顧客情報のシグナルが入っていることを確認
4. 結果の **メタデータ** に `elapsedMs` や `totalTokens` が入っていることを確認（モデルには見えない、アプリ用の情報）
5. 「プランを変更したいです」を送り、今度はシステムプロンプトに「山田 花子 様（Pro プラン）」が入っていることを確認
6. 初期データの `customerId` を `"C-77"`、会話IDを `account-2` にして送ると、佐藤さんになる

## やってみよう

1. `initialData` を `{"customer": 1}` にして（会話IDも新しくして）送り、スキーマ検証で会話の作成が失敗するのを見る
2. `useResponseFinish` の戻り値に `model: 'haiku'` などを足して、メタデータに出るか確認する
