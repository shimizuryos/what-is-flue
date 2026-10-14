---
title: プレイグラウンド（総まとめ）
summary: これまでの要素を組み合わせた旅行プランナーを自由に改造する
entry: src/agents/travel-planner.ts
conversationId: trip-1
messages:
  - set_destination で行き先を「札幌」にして
  - weather で天気を調べて、packing-list スキルで持ち物を考えて
  - budget-advisor に「3泊4日・予算5万円の札幌旅行」の節約術を聞いて
---

## 総まとめ

右のエディタには、これまでに学んだ要素を全部使った「旅行プランナー」が入っています。自由に書き換えて実行してみましょう。壊してしまっても **↺ リセット** で元に戻せます。

## チートシート

```ts
'use agent';                                   // エージェントモジュールの目印
import { useModel, useTool, ... } from '@flue/runtime';

export function MyAgent({ id }: AgentProps) {  // エージェント = 関数（id = 会話ID）
  useModel('anthropic/claude-haiku-4-5');      // 必須：使う LLM
  const [x, setX] = usePersistentState('x', 0); // 会話ごとに永続化される状態
  const data = useInitialData<T>();            // 会話作成時のデータ
  useTool({ name, description, input, run });  // ツール（if で囲めば条件付き）
  useSkill(skill);                             // スキル（SKILL.md を import / defineSkill）
  useSubagent({ name, description, agent });   // サブエージェント（task ツールで委任）
  useSandbox(bash(() => new Bash()));          // ファイルとシェル（read/write/bash…）
  useMcpConnection(...);                       // MCP サーバーのツールを取り込む
  useInstruction('追加の指示');                 // 指示を後ろに追記
  useAgentStart(async (ctx) => { ... });       // メッセージ到着時（モデル実行前）
  useAgentFinish(async (ctx) => { ... });      // 返答を終える直前（やり直させられる）
  useResponseStart(() => ({ ... }));           // 返答メタデータ（開始）
  useResponseFinish(() => ({ ... }));          // 返答メタデータ（終了）
  const write = useDataWriter('name');         // 画面へ構造化データを流す
  return '指示（システムプロンプト）';
}
```

| 動かし方 | コード |
| --- | --- |
| CLI | `npx flue run src/agents/x.ts --id 会話ID --message "..."` |
| スクリプト | `await start({ agents: [X] }); const h = init(X, { id }); await h.read(await h.dispatch('...'))` |
| アプリ内（Webhook など） | `await dispatch(X, { id, message })` |
| HTTP | `app.route('/agents/x', createAgentRouter(X))` → `POST /agents/x/:id` |

## 本物の LLM で動かすには

1. プロジェクト直下に `.env` を作り、`ANTHROPIC_API_KEY="sk-ant-..."` を書く（`.env.example` を参照）
2. サーバーを再起動し、上部のモード切り替えで **本物のLLM** を選ぶ
3. ほかのプロバイダーを使うなら `useModel('openai/gpt-5.5')` のように書き換え、対応するキー（`OPENAI_API_KEY` など）を設定する

本物の LLM なら、ツール名を書かなくても「札幌に行きたい！天気と持ち物を教えて」のような自然な文章で、エージェントが自分でツールやスキルを選んで動きます。

## 次のステップ

- 公式ドキュメント：[flueframework.com/docs](https://flueframework.com/docs/guide/getting-started/)
- 自分のプロジェクトを作る：`npx flue init`
- オフラインでドキュメントを読む：`npx flue docs`
