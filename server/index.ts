// Flue Playground のサーバー。
//
//   GET  /api/status  … 実行モード（モック / 本物のLLM）や API キーの有無
//   POST /api/run     … 学習者のコードをワークスペースに書き出し、ランナー子プロセスで実行。
//                       イベントを NDJSON でストリーミング返却する
//   POST /api/reset   … レッスンのワークスペース（会話の保存先）を削除
//
// それ以外のリクエストは学習用 UI（開発時は Vite、本番は dist/）に渡します。
// ⚠️ 入力されたコードをそのまま実行するため、既定では 127.0.0.1 にだけ公開します。

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { RunEvent, RunnerInput, RunRequestBody } from './protocol.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = path.join(ROOT, '.playground', 'workspaces');
const RUNNER = path.join(ROOT, 'server', 'runner', 'run-agent.ts');
const DIST = path.join(ROOT, 'dist');
const DEV = process.argv.includes('--dev');
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 120_000);

loadDotEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? '127.0.0.1';

/** 実行中のランナー（ワークスペースごとに 1 つ。SQLite の会話データを同時に触らないため） */
const activeRuns = new Map<string, ChildProcess>();

const vite = DEV
  ? await (await import('vite')).createServer({
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    })
  : undefined;

if (!DEV && !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ がありません。先に `npm run build` を実行するか、`npm run dev` で起動してください。');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/status' && req.method === 'GET') return sendJson(res, 200, status());
    if (url.pathname === '/api/run' && req.method === 'POST') return await handleRun(req, res);
    if (url.pathname === '/api/reset' && req.method === 'POST') return await handleReset(req, res);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: String(error) });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const mode = status().realModeAvailable ? 'モックLLM / 本物のLLM の両方が使えます' : 'モックLLMで動作します（.env に API キーを置くと本物のLLMも使えます）';
  console.log(`\n  Flue Playground: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  console.log(`  ${mode}\n`);
});

// ---------------------------------------------------------------------------

const KEY_NAMES: Record<string, string> = {
  ANTHROPIC_API_KEY: 'anthropic',
  OPENAI_API_KEY: 'openai',
  GEMINI_API_KEY: 'google',
  GROQ_API_KEY: 'groq',
  MISTRAL_API_KEY: 'mistral',
  XAI_API_KEY: 'xai',
  DEEPSEEK_API_KEY: 'deepseek',
  OPENROUTER_API_KEY: 'openrouter',
  CEREBRAS_API_KEY: 'cerebras',
  TOGETHER_API_KEY: 'together',
  FIREWORKS_API_KEY: 'fireworks',
};

function status() {
  const providers = Object.entries(KEY_NAMES)
    .filter(([key]) => (process.env[key] ?? '').trim() !== '')
    .map(([, provider]) => provider);
  return {
    realModeAvailable: providers.length > 0,
    providersWithKeys: providers,
    nodeVersion: process.versions.node,
    flueVersion: readPackageVersion('@flue/runtime'),
  };
}

async function handleRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await readJson(req)) as RunRequestBody;
  const problem = validateRun(body);
  if (problem) return sendJson(res, 400, { error: problem });

  let initialData: unknown;
  if (body.initialData && body.initialData.trim() !== '') {
    try {
      initialData = JSON.parse(body.initialData);
    } catch {
      return sendJson(res, 400, { error: 'initialData が正しい JSON ではありません。' });
    }
  }

  const workspace = path.join(WORKSPACES, body.clientId, body.lessonId);
  // 同じワークスペースで実行中のものがあれば止める
  activeRuns.get(workspace)?.kill('SIGKILL');
  writeWorkspace(workspace, body.files);

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  const send = (event: RunEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };

  const env = { ...process.env };
  if (body.mode === 'mock') {
    // モックでは本物の API を絶対に呼ばないよう、キーを子プロセスに渡さない
    for (const key of Object.keys(env)) if (/_API_KEY$/.test(key)) delete env[key];
  }

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', RUNNER], {
    cwd: workspace,
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  activeRuns.set(workspace, child);
  child.on('error', (error) => {
    send({ type: 'error', phase: 'server', message: `ランナーを起動できませんでした: ${error.message}` });
  });

  const input: RunnerInput = {
    workspace,
    entry: body.entry,
    agentName: body.agentName || undefined,
    conversationId: body.conversationId,
    message: body.message,
    initialData,
    mode: body.mode,
    http: body.http,
  };
  child.stdin!.end(JSON.stringify(input));

  let sawDone = false;
  forwardLines(child.stdio[3] as NodeJS.ReadableStream, (line) => {
    try {
      const event = JSON.parse(line) as RunEvent;
      if (event.type === 'done') sawDone = true;
      send(event);
    } catch {
      send({ type: 'log', level: 'stdout', text: line });
    }
  });
  forwardLines(child.stdout!, (line) => send({ type: 'log', level: 'stdout', text: line }));
  forwardLines(child.stderr!, (line) => send({ type: 'log', level: 'stderr', text: line }));

  const startedAt = Date.now();
  const timer = setTimeout(() => {
    send({ type: 'error', phase: 'server', message: `実行が ${RUN_TIMEOUT_MS / 1000} 秒を超えたため停止しました。` });
    child.kill('SIGKILL');
  }, RUN_TIMEOUT_MS);

  // ブラウザ側で「停止」されたら子プロセスも止める
  res.on('close', () => {
    if (!sawDone) child.kill('SIGKILL');
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (activeRuns.get(workspace) === child) activeRuns.delete(workspace);
    // fd 3 の残りを読み切ってから終了イベントを補う
    setImmediate(() => {
      if (!sawDone) {
        send({ type: 'done', outcome: code === 0 ? 'completed' : 'error', elapsedMs: Date.now() - startedAt });
      }
      res.end();
    });
  });
}

async function handleReset(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { clientId?: string; lessonId?: string };
  if (!isSafeId(body.clientId) || !isSafeId(body.lessonId)) return sendJson(res, 400, { error: 'invalid id' });
  const workspace = path.join(WORKSPACES, body.clientId!, body.lessonId!);
  activeRuns.get(workspace)?.kill('SIGKILL');
  fs.rmSync(workspace, { recursive: true, force: true });
  sendJson(res, 200, { ok: true });
}

function validateRun(body: RunRequestBody): string | undefined {
  if (!body || typeof body !== 'object') return 'リクエストが不正です。';
  if (!isSafeId(body.clientId) || !isSafeId(body.lessonId)) return 'clientId / lessonId が不正です。';
  if (body.mode !== 'mock' && body.mode !== 'real') return 'mode は mock か real です。';
  if (typeof body.message !== 'string' || body.message.trim() === '') return 'メッセージを入力してください。';
  if (typeof body.conversationId !== 'string' || !/^[\w.:-]{1,128}$/.test(body.conversationId)) {
    return '会話ID には英数字と - _ . : だけが使えます。';
  }
  if (!body.files || typeof body.files !== 'object') return 'files がありません。';
  for (const file of Object.keys(body.files)) {
    if (!isSafeRelativePath(file)) return `ファイルパスが不正です: ${file}`;
  }
  if (!isSafeRelativePath(body.entry) || !(body.entry in body.files)) return `entry が files に含まれていません: ${body.entry}`;
  if (body.http && !/^\/[\w/-]*$/.test(body.http.mountPath)) return 'mountPath が不正です。';
  return undefined;
}

function writeWorkspace(workspace: string, files: Record<string, string>): void {
  fs.mkdirSync(workspace, { recursive: true });
  // 前回のソースは消して書き直す（会話を保存している SQLite ファイルは残す）
  for (const entry of fs.readdirSync(workspace)) {
    if (entry.startsWith('.flue-playground.db')) continue;
    fs.rmSync(path.join(workspace, entry), { recursive: true, force: true });
  }
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(workspace, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function isSafeId(value: unknown): boolean {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  if (path.isAbsolute(value) || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..' && /^[\w.@-]+$/.test(part));
}

function forwardLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) onLine(buffer);
    buffer = '';
  });
}

// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const decoded = decodeURIComponent(pathname);
  let file = path.join(DIST, decoded);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new Error('request too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const values = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    // シェルで設定済みの値を優先する（flue run と同じ挙動）
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}

function readPackageVersion(name: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}
