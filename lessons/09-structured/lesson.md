---
title: 構造化データを扱う
summary: ハーネスツールと result スキーマで型付きの答えをもらい、useDataWriter で画面にデータを流す
entry: src/agents/review-analyst.ts
conversationId: review-1
messages:
  - review_text で「毎朝使っています。音が静かでとても気に入りました。」を分析して
  - batch_analyze で 5 件まとめて分析して
---

## 文章ではなく「データ」が欲しいとき

LLM の返事は基本的に文章です。でもアプリでは `{ sentiment: 'positive', score: 8 }` のような **型の決まったデータ** が欲しいことがよくあります。Flue では **ハーネスツール** と **result スキーマ** でこれを実現します。

## ハーネスツール（`harness: true`）

普通のツールは「入力 → 出力」の純粋な関数ですが、`harness: true` を付けると `run` が `harness` を受け取れます。

- `harness.sandbox`：エージェントのサンドボックスを直接操作（`readFile`・`writeFile`・`exec` など）。会話には記録されない
- `harness.prompt(text, options)`：ツールの中で **別の小さな会話** としてモデルを呼ぶ

## result スキーマで型付きの答えを受け取る

```ts
const { data: review } = await harness.prompt('review.txt を分析して', { result: Review });
// review は { sentiment, score, summary } 型！
```

`result` に Valibot スキーマを渡すと、Flue はモデルに `finish` ツールを渡し、「終わったらこのスキーマに合う引数で `finish` を呼べ」と指示します。スキーマに合わなければモデルにエラーが返り、やり直させます。

タイムラインで確認してみましょう。

1. 親エージェントが `review_text` を呼ぶ
2. その中で 🧰 **harness** の別会話が始まり、モデルに `finish` / `give_up` ツールが追加される（🔍 で確認）
3. モデルが `finish({ sentiment, score, summary })` を呼ぶ
4. 検証済みのデータが `review_text` の結果として親に返る

> 💡 **モックLLMのルール**：`finish` ツールが使えるときは、スキーマを読んでそれに合う値（列挙値の先頭、数値など）で `finish` を呼びます。

## useDataWriter：画面にデータを流す

`useDataWriter('progress', { schema })` は、**画面（クライアント）向け** のデータチャンネルを作ります。

- 書き込んだデータはすぐにクライアントへストリーミングされる（進捗バー、注文カード、グラフなど）
- **モデルには見えない**。エージェント関数の再実行も起きない
- 同じ名前に何度も書くと、返答の中のそのデータが **上書き更新** される（最終的な返答の `data` には最後の値が残る）

`batch_analyze で 5 件まとめて分析して` を送ると、結果の **📦 データ** 欄に進捗が流れてくるのが見えます。React なら `@flue/react` の `useFlueAgent()` で、`data-progress` パーツとして受け取って描画できます。

## やってみよう

1. `Review` スキーマに `keywords: v.array(v.string())` を足してみる
2. `writeProgress` に `label` の無いデータを書いて、スキーマ検証エラーになるのを見る
