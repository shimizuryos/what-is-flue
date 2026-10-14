---
title: スキルで専門知識を渡す
summary: SKILL.md と useSkill で「必要なときだけ読む手順書」を渡す
entry: src/agents/writer.ts
conversationId: skills-1
messages:
  - haiku スキルで秋の俳句を作って
  - apology-email スキルで配送遅延のお詫びメールを書いて
  - 今日の天気について一言
---

## スキルとは

**スキル** は「手順書」です。ツールがコードを実行するのに対し、スキルはモデルに **やり方** を教えます。

スキルは 3 つの部品からなります。

- **name**：スキルの名前（モデルが読み込むときに使う）
- **description**：何をするスキルか、**いつ使うか**。モデルはこれだけを見て使うかどうかを決める
- **instructions**：手順の本文。**読み込まれたときにだけ** モデルに渡される

## 段階的な読み込み（Progressive Disclosure）

スキルの本文は、最初はモデルに送られません。システムプロンプトに載るのは 1 行の「目次」だけです。

1. 🔍 を見ると、システムプロンプトに `## Available Skills` があり、`haiku` と `apology-email` の名前と説明だけが載っている
2. モデルが「このスキルが必要だ」と判断すると `activate_skill` ツールを呼ぶ
3. その結果として、スキルの本文（instructions）が初めてモデルに届く
4. `EXAMPLES.md` のような補助ファイルは、さらに必要になったときだけ `read_skill_resource` で読む

だから、スキルをたくさん付けてもトークンの無駄になりません。

## スキルの書き方は 2 通り

**① SKILL.md ファイル**（[Agent Skills](https://agentskills.io) 形式。他のツールとも共通）

```text
src/skills/haiku/
├─ SKILL.md      ← frontmatter に name と description、本文が手順
└─ EXAMPLES.md   ← 補助ファイル（必要なときだけ読まれる）
```

`import haiku from '../skills/haiku/SKILL.md'` のように **import するだけ** で、ディレクトリごとビルドに含まれます。

**② defineSkill()**（短い・データから生成するスキル向け）

```ts
export const apologyEmail = defineSkill({ name, description, instructions });
```

どちらも `useSkill(...)` で取り付けます。

## 試してみよう

> 💡 **モックLLMのルール**：メッセージに **スキル名**（`haiku`・`apology-email`）が含まれていると `activate_skill` を呼びます。

1. 「haiku スキルで秋の俳句を作って」→ タイムラインで `activate_skill` の結果に **スキル本文** が入っていることを確認
2. 「今日の天気について一言」→ スキル名が無いので読み込まれない（本物の LLM も、説明に合わない依頼ではスキルを使わないはず）

## やってみよう

1. `SKILL.md` の description を書き換え、🔍 のシステムプロンプトに反映されることを確認する
2. 自分のスキル（例：`review-checklist`）を `src/skills/` に作って取り付ける。name はディレクトリ名と同じ、英小文字とハイフンだけにする必要があります
