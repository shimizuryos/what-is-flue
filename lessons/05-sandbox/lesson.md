---
title: サンドボックスで作業させる
summary: useSandbox でファイル操作とコマンド実行の環境を与える
entry: src/agents/analyst.ts
conversationId: sandbox-1
messages:
  - "$ ls -la /data"
  - "$ cat /data/sales.csv"
  - "$ awk -F, 'NR>1 {sum[$2]+=$3} END {for (k in sum) print k, sum[k]}' /data/sales.csv"
  - "$ echo 'メモ' > /data/note.txt\n$ cat /data/note.txt"
---

## サンドボックスとは

**サンドボックス** は、エージェントにファイルを読み書きさせたり、コマンドを実行させたりするための「作業場所」です。`useSandbox()` で取り付けると、次のものがまとめて手に入ります。

- **組み込みツール**：`read`・`write`・`edit`・`bash`・`grep`・`glob`
- **作業ディレクトリの情報**：カレントディレクトリやファイル一覧が自動でシステムプロンプトに入る（`AGENTS.md` があればその内容も）
- コードからの直接操作：ハーネスツールの `harness.sandbox.readFile()` など（レッスン 9）

サンドボックスを付けなければ、これらのツールは存在しません。必要なエージェントにだけ、必要な範囲で与えるのが基本です。

## 3 種類のサンドボックス

| 種類 | 書き方 | 特徴 |
| --- | --- | --- |
| **仮想サンドボックス** | `bash(() => new Bash({ fs: new InMemoryFs() }))` | メモリ上のファイル + TypeScript で再現した bash（[just-bash](https://github.com/vercel-labs/just-bash)）。ホストに触れず安全・軽量。**メッセージごとにリセット** される |
| **ローカル** | `local()`（`@flue/runtime/node`） | ホストの本物のファイルとシェルを使う。開発ツールや CI 向け。隔離は無い |
| **リモート** | Daytona・E2B・Vercel・Cloudflare など | 会話ごとに本物の Linux コンテナを用意。アダプター経由で接続 |

このレッスンでは安全な仮想サンドボックスを使います（`just-bash` パッケージが必要です）。

## 試してみよう

> 💡 **モックLLMのルール**：`$ コマンド` で始まる行を送ると、モックLLMがそのコマンドを `bash` ツールで実行します。複数行書けば順番に実行します。本物の LLM なら「商品ごとの売上合計を出して」と頼むだけで、自分でコマンドを考えて実行します。

1. `$ ls -la /data` でファイル一覧を見る
2. `$ cat /data/sales.csv` で中身を見る
3. awk で商品ごとに集計する（サンプルメッセージ 3 つ目）
4. `$ echo 'メモ' > /data/note.txt` でファイルを作る → 次のメッセージで `$ ls /data` すると **消えている**

4 の結果が仮想サンドボックスの特徴です。ファイルはメッセージ（の処理）ごとに作り直されます。会話をまたいで残したい情報は、ファイルではなく `usePersistentState`（レッスン 4）に入れましょう。ファイル自体を残したいなら、ローカルやリモートのサンドボックスを使います。

🔍 **モデルへの入力** でツール一覧を見ると、`read`・`write`・`bash` などが増えています。システムプロンプトの末尾には `Working directory:` なども追加されています。

## やってみよう

1. `InMemoryFs` に自分の CSV や JSON を追加して、`jq` や `grep` で調べてみる
2. `/data/AGENTS.md` を追加して、その内容がシステムプロンプトに入ることを 🔍 で確認する
3. `useSandbox(...)` の行を消して実行し、`bash` ツールが無くなることを確認する
