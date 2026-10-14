// ランナー：学習者のコードを「本物の Flue ランタイム」で 1 回実行する子プロセス。
//
// やっていることは `flue run` とほぼ同じです:
//   1. Vite（SSR, ポートは開かない）でエージェントモジュールを読み込む（.ts や SKILL.md の import を解決）
//   2. start() で Flue ランタイムを起動（会話はワークスペースの SQLite に保存）
//   3. init(Agent, { id }).dispatch(message) → read() で返答を待つ
// 違いは observe() で全イベントを購読し、モデルに送られた内容やツール呼び出しを
// fd 3 に NDJSON として書き出すことです（サーバーがブラウザへ中継します）。

import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import type { RunEvent, RunnerInput, ToolInfo, ModelMessageView } from '../protocol.ts';

const out = fs.createWriteStream('', { fd: 3 });
let workspaceRoot = '';
function emit(event: RunEvent): void {
  if (event.type === 'error') event = polishError(event);
  out.write(`${JSON.stringify(event)}\n`);
}

// 学習者コードの console.* はログイベントとして UI に表示する
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[level] = (...args: unknown[]) => emit({ type: 'log', level, text: format(...args) });
}

const startedAt = Date.now();
let finished = false;
async function finish(outcome: 'completed' | 'failed' | 'aborted' | 'error'): Promise<never> {
  if (!finished) {
    finished = true;
    emit({ type: 'done', outcome, elapsedMs: Date.now() - startedAt });
  }
  await new Promise<void>((resolve) => out.end(resolve));
  process.exit(outcome === 'completed' ? 0 : 1);
}

process.on('uncaughtException', (error) => {
  emit({ type: 'error', phase: 'run', message: errorMessage(error), detail: errorDetail(error) });
  void finish('error');
});
process.on('unhandledRejection', (error) => {
  emit({ type: 'error', phase: 'run', message: errorMessage(error), detail: errorDetail(error) });
  void finish('error');
});

const input = JSON.parse(fs.readFileSync(0, 'utf8')) as RunnerInput;
workspaceRoot = input.workspace;
await main(input);

async function main(input: RunnerInput): Promise<void> {
  emit({ type: 'status', text: 'コードを読み込み中…' });

  // Flue 関連はランナー内でも動的 import（読み込み失敗もイベントとして返すため）
  const { createServer } = await import('vite');
  const { markdownImportPlugin, scanAgentModuleCode } = await import('@flue/vite/internal');
  const runtime = await import('@flue/runtime');
  const { start, sqlite } = await import('@flue/runtime/node');

  const root = input.workspace;
  const vite = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    logLevel: 'silent',
    resolve: { preserveSymlinks: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ['@earendil-works/pi-ai'] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [markdownImportPlugin()],
  });

  type AgentFn = ((...args: never[]) => unknown) & { agentName?: string };
  const warnings: string[] = [];
  let agents: { name: string; agent: AgentFn }[] = [];
  let selected: { name: string; agent: AgentFn };
  let app: { fetch(request: Request): Response | Promise<Response> } | undefined;

  try {
    if (input.http) {
      // HTTP モード: src/**/*.ts から 'use agent' モジュールを探して登録し、entry（app.ts）を読み込む
      for (const file of listSourceFiles(root)) {
        const code = fs.readFileSync(file, 'utf8');
        if (!hasUseAgentDirective(code)) continue;
        agents.push(...(await loadAgents(file, code)));
      }
      const appModule = (await vite.ssrLoadModule(path.join(root, input.entry))) as { default?: typeof app };
      app = appModule.default;
      if (!app || typeof app.fetch !== 'function') {
        throw new Error(`${input.entry} は fetch() を持つオブジェクト（例: new Hono()）を default export してください。`);
      }
      if (agents.length === 0) throw new Error("'use agent' が付いたエージェントモジュールが見つかりません。");
      selected = agents[0]!;
    } else {
      const entryPath = path.join(root, input.entry);
      const code = fs.readFileSync(entryPath, 'utf8');
      if (!hasUseAgentDirective(code)) {
        warnings.push(
          "ファイル先頭に 'use agent' ディレクティブがありません。flue run は動きますが、vite build（本番ビルド）ではエージェントとして登録されません。",
        );
      }
      agents = await loadAgents(entryPath, code);
      if (agents.length === 0) {
        throw new Error(
          `${input.entry} はエージェントを export していません。大文字で始まる関数を export してください（例: export function Assistant() { … }）。`,
        );
      }
      if (input.agentName) {
        const match = agents.find((a) => a.name === input.agentName);
        if (!match) throw new Error(`エージェント "${input.agentName}" が見つかりません。候補: ${agents.map((a) => a.name).join(', ')}`);
        selected = match;
      } else if (agents.length > 1) {
        throw new Error(`複数のエージェント（${agents.map((a) => a.name).join(', ')}）が export されています。エージェント名を指定してください。`);
      } else {
        selected = agents[0]!;
      }
      agents = [selected];
    }
  } catch (error) {
    emit({ type: 'error', phase: 'load', message: errorMessage(error), detail: errorDetail(error) });
    await vite.close().catch(() => {});
    return finish('error');
  }

  async function loadAgents(file: string, code: string): Promise<{ name: string; agent: AgentFn }[]> {
    const scan = await scanAgentModuleCode(code, file, { requireDirective: false });
    const mod = (await vite.ssrLoadModule(file)) as Record<string, unknown>;
    const found: { name: string; agent: AgentFn }[] = [];
    for (const { exportName } of scan.agents) {
      const value = mod[exportName];
      if (typeof value !== 'function') continue;
      const agent = value as AgentFn;
      const exported = exportName === 'default' ? agent.name : exportName;
      found.push({ name: typeof agent.agentName === 'string' ? agent.agentName : exported, agent });
    }
    return found;
  }

  const cliCommand = input.http
    ? `curl -X POST http://localhost:5173${input.http.mountPath}/${input.conversationId} -H 'content-type: application/json' -d '${JSON.stringify({ kind: 'user', body: input.message }).replace(/'/g, "'\\''")}'`
    : [
        'npx flue run',
        input.entry,
        agents.length > 1 || input.agentName ? `--name ${selected.name}` : '',
        `--id ${input.conversationId}`,
        input.initialData !== undefined ? `--data '${JSON.stringify(input.initialData)}'` : '',
        `--message ${shellQuote(input.message)}`,
      ]
        .filter(Boolean)
        .join(' ');

  emit({
    type: 'meta',
    agentName: selected.name,
    conversationId: input.conversationId,
    mode: input.mode,
    cli: cliCommand,
    warnings,
  });

  // ---- イベント購読 -------------------------------------------------------
  const turnModel = new Map<string, string>();
  // 失敗の本当の原因（observation の errorInfo）。submission_settled の error は汎用メッセージに置き換わるため
  let settledErrorInfo: { message?: string; stack?: string } | undefined;
  runtime.observe((event) => {
    const e = event as unknown as Record<string, any>;
    const taskId: string | undefined = e.taskId;
    const harness: string | undefined = e.harness && e.harness !== 'default' ? e.harness : undefined;
    switch (e.type) {
      case 'turn_request': {
        if (e.purpose !== 'agent') return;
        const req = e.request;
        turnModel.set(e.turnId, `${req.providerId}/${req.requestedModel}`);
        emit({
          type: 'turn',
          turnId: e.turnId,
          taskId,
          harness,
          model: `${req.providerId}/${req.requestedModel}`,
          systemPrompt: req.input?.systemPrompt ?? '',
          tools: ((req.input?.tools ?? []) as any[]).map(
            (t): ToolInfo => ({ name: t.name, description: t.description, parameters: t.parameters }),
          ),
          messages: ((req.input?.messages ?? []) as any[]).map(viewMessage),
        });
        return;
      }
      case 'turn': {
        if (e.purpose !== 'agent') return;
        emit({
          type: 'turn-end',
          turnId: e.turnId,
          taskId,
          durationMs: e.durationMs,
          finishReason: e.response?.finishReason,
          tokens: e.response?.usage?.totalTokens,
          error: e.isError ? (e.response?.error?.message ?? 'model error') : undefined,
        });
        return;
      }
      case 'text_delta':
        emit({ type: 'text-delta', turnId: e.turnId, taskId, harness, text: e.text });
        return;
      case 'tool_start':
        emit({
          type: 'tool-start',
          toolCallId: e.toolCallId,
          taskId,
          harness,
          toolName: e.toolName,
          args: (event as any).args ?? e.args ?? null,
        });
        return;
      case 'tool':
        emit({
          type: 'tool-end',
          toolCallId: e.toolCallId,
          taskId,
          harness,
          toolName: e.toolName,
          isError: e.isError,
          result: simplifyToolResult(e.result),
          durationMs: e.durationMs,
        });
        return;
      case 'task_start':
        emit({ type: 'task-start', taskId: e.taskId, agent: e.agent, prompt: e.prompt });
        return;
      case 'task':
        emit({ type: 'task-end', taskId: e.taskId, agent: e.agent, isError: e.isError, result: e.result, durationMs: e.durationMs });
        return;
      case 'log':
        emit({ type: 'tool-log', taskId, level: e.level ?? 'info', text: e.message ?? '' });
        return;
      case 'submission_settled':
      case 'operation':
        if (e.errorInfo && !settledErrorInfo) settledErrorInfo = e.errorInfo;
        return;
      default:
        return;
    }
  });

  // ---- ランタイム起動 -----------------------------------------------------
  let flue: { stop(): Promise<void> };
  try {
    emit({ type: 'status', text: 'Flue ランタイムを起動中…' });
    let providers: import('@earendil-works/pi-ai').Provider[] | undefined;
    if (input.mode === 'mock') {
      const { createMockProviders } = await import('./mock-llm.ts');
      providers = createMockProviders();
    }
    flue = await start({
      agents: agents.map((a) => ({ agent: a.agent as never, name: a.name })),
      db: sqlite(path.join(root, '.flue-playground.db')),
      ...(providers ? { providers } : {}),
    });
  } catch (error) {
    emit({ type: 'error', phase: 'load', message: errorMessage(error), detail: errorDetail(error) });
    await vite.close().catch(() => {});
    return finish('error');
  }

  emit({ type: 'status', text: 'エージェントを実行中…' });
  let outcome: 'completed' | 'failed' | 'aborted' = 'completed';
  try {
    if (input.http && app) {
      await runOverHttp(app, input, selected.agent);
    } else {
      const handle = runtime.init(selected.agent as never, { id: input.conversationId });
      const receipt = await handle.dispatch(
        input.initialData !== undefined
          ? { message: input.message, initialData: input.initialData }
          : input.message,
      );
      const reply = await handle.read(receipt, {
        onEvent: (chunk) => {
          // useDataWriter() の書き込みは data-part チャンクとしてリアルタイムに届く
          const c = chunk as unknown as { type: string; name?: string; data?: unknown };
          if (c.type === 'data-part' && c.name) emit({ type: 'data', name: c.name, data: c.data });
        },
      });
      emit({
        type: 'reply',
        text: reply.text,
        data: reply.data,
        metadata: reply.metadata,
        submissionId: reply.submissionId,
        uid: reply.uid,
      });
    }
  } catch (error) {
    const e = error as { outcome?: 'failed' | 'aborted'; cause?: unknown };
    outcome = e.outcome ?? 'failed';
    const cause = e.cause ?? error;
    const info = settledErrorInfo;
    emit({
      type: 'error',
      phase: 'run',
      message: info?.message ?? errorMessage(cause),
      detail: info?.stack ? info.stack.split('\n').slice(0, 8).join('\n') : errorDetail(cause),
    });
  }

  await flue.stop().catch(() => {});
  await vite.close().catch(() => {});
  return finish(outcome);

  async function runOverHttp(
    app: { fetch(request: Request): Response | Promise<Response> },
    input: RunnerInput,
    agent: AgentFn,
  ): Promise<void> {
    const base = 'http://localhost:5173';
    const url = `${base}${input.http!.mountPath}/${encodeURIComponent(input.conversationId)}`;
    const body: Record<string, unknown> = { kind: 'user', body: input.message };
    if (input.initialData !== undefined) body.initialData = input.initialData;

    const post = await app.fetch(
      new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    );
    const admission = (await readBody(post)) as { submissionId?: string };
    emit({ type: 'http', method: 'POST', url: url.replace(base, ''), requestBody: body, status: post.status, responseBody: admission });
    if (post.status !== 202 || !admission.submissionId) {
      throw new Error(`POST が ${post.status} を返しました。`);
    }

    // 202 は「受け付けた」だけ。返答は会話を読んで確認する（ここではランタイムの read() で完了を待つ）
    const reply = await runtime.init(agent as never, { id: input.conversationId }).read(admission.submissionId);

    const get = await app.fetch(new Request(url, { method: 'GET' }));
    emit({ type: 'http', method: 'GET', url: url.replace(base, ''), status: get.status, responseBody: await readBody(get) });
    emit({ type: 'reply', text: reply.text, data: reply.data, metadata: reply.metadata, submissionId: reply.submissionId, uid: reply.uid });
  }
}

// ---------------------------------------------------------------------------

/** エラーからワークスペースの絶対パスを取り除き、よくある失敗には日本語のヒントを付ける */
function polishError(event: Extract<RunEvent, { type: 'error' }>): Extract<RunEvent, { type: 'error' }> {
  const strip = (text: string | undefined) =>
    text && workspaceRoot ? text.split(`${workspaceRoot}/`).join('').split(workspaceRoot).join('.') : text;
  const message = strip(event.message) ?? '';
  const detail = strip(event.detail);
  const all = `${message}\n${detail ?? ''}`;
  let hint = event.hint;
  const provider = /Provider is not configured: ([\w-]+)/.exec(all)?.[1];
  if (provider) {
    hint = `プロバイダー「${provider}」の API キーが設定されていません。.env にキー（例: ANTHROPIC_API_KEY）を書いてサーバーを再起動するか、モックLLMモードで実行してください。`;
  } else if (/requires a model/.test(all)) {
    hint = "エージェント関数の中で useModel('プロバイダー/モデル') を 1 回呼んでください。";
  } else if (/initialData schema|creation data/i.test(all)) {
    hint = '初期データ (JSON) がエージェントの initialData スキーマに合っていません。データを直し、会話IDを新しくして送り直してください。';
  } else if (/Failed to load url|Cannot find module|does not provide an export|Failed to resolve import/i.test(all)) {
    hint = 'import のパスや名前を確認してください。相対パスの import には .ts などの拡張子を付けます（例: ../tools/my-tool.ts）。';
  } else if (/Unable to parse|Parse failed|SyntaxError|Unexpected token/i.test(all)) {
    hint = 'コードに文法エラーがあります。括弧やカンマの対応を確認してください。';
  } else if (/must be synchronous/.test(all)) {
    hint = 'エージェント関数は async にできません。非同期の処理はツールや useAgentStart の中に書きます。';
  } else if (/Re-entrant agent render/.test(all)) {
    hint = 'エージェント関数の中で別のエージェント関数を直接呼ばないでください。委任には useSubagent を使います。';
  }
  return { ...event, message, detail, ...(hint ? { hint } : {}) };
}

function hasUseAgentDirective(code: string): boolean {
  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use agent['"]/.test(code);
}

function listSourceFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push(full);
    }
  };
  walk(path.join(root, 'src'));
  return result;
}

function viewMessage(message: any): ModelMessageView {
  const role: string = message.role ?? '?';
  const content = message.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((block: any) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'thinking') return `💭 ${block.thinking}`;
        if (block.type === 'toolCall') return `🔧 ${block.name}(${JSON.stringify(block.arguments)})`;
        if (block.type === 'image') return '[画像]';
        return '';
      })
      .join('\n');
  }
  if (role === 'toolResult') text = `[${message.toolName}] ${text}`;
  return { role, text };
}

function simplifyToolResult(result: any): unknown {
  if (result && Array.isArray(result.content)) {
    const text = result.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result ?? null;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

function errorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const parts: string[] = [];
  const details = (error as { details?: unknown }).details;
  if (typeof details === 'string') parts.push(details);
  if (error.stack) parts.push(error.stack.split('\n').slice(0, 8).join('\n'));
  return parts.join('\n\n') || undefined;
}
