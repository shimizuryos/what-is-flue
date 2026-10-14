// 全レッスンのサンプルメッセージを、モックLLMモードで実際に実行して確かめるスクリプト。
//   npm test                 … 全レッスン
//   npm test -- 03-tools     … 指定したレッスンだけ
//
// 各メッセージについて「正常に完了したか」と「期待したツールが呼ばれたか」を検査します。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunEvent, RunnerInput } from '../server/protocol.ts';
import { parseLessonMarkdown } from '../web/src/lesson-format.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LESSONS = path.join(ROOT, 'lessons');
const RUNNER = path.join(ROOT, 'server', 'runner', 'run-agent.ts');
const WORK = path.join(ROOT, '.playground', 'test-lessons');

/** レッスンごと・メッセージごとに呼ばれるべきツール（順不同、部分一致） */
const EXPECTED_TOOLS: Record<string, string[][]> = {
  '01-hello': [[], []],
  '02-conversations': [[], []],
  '03-tools': [['lookup_order'], ['lookup_order'], ['current_time']],
  '04-state': [[], ['escalate'], ['refund'], ['record_inquiry']],
  '05-sandbox': [['bash'], ['bash'], ['bash'], ['bash', 'bash']],
  '06-skills': [['activate_skill'], ['activate_skill'], []],
  '07-subagents': [['task'], ['task'], ['task', 'task']],
  '08-lifecycle': [[], []],
  '09-structured': [['review_text', 'finish'], ['batch_analyze']],
  '10-http': [[], []],
  '11-playground': [['set_destination'], ['weather', 'activate_skill'], ['task']],
};

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const lessonIds = fs
  .readdirSync(LESSONS)
  .filter((name) => fs.existsSync(path.join(LESSONS, name, 'lesson.md')))
  .filter((name) => only.length === 0 || only.some((o) => name.includes(o)))
  .sort();

let failures = 0;
fs.rmSync(WORK, { recursive: true, force: true });

for (const id of lessonIds) {
  const { meta } = parseLessonMarkdown(fs.readFileSync(path.join(LESSONS, id, 'lesson.md'), 'utf8'));
  const workspace = path.join(WORK, id);
  copyDir(path.join(LESSONS, id, 'files'), workspace);
  console.log(`\n■ ${id} — ${meta.title}`);

  for (const [index, message] of meta.messages.entries()) {
    const events = await run({
      workspace,
      entry: meta.entry,
      agentName: meta.agentName,
      conversationId: meta.conversationId,
      message,
      initialData: meta.initialData ? JSON.parse(meta.initialData) : undefined,
      mode: 'mock',
      http: meta.http ? { mountPath: meta.http } : undefined,
    });
    const done = events.find((e): e is Extract<RunEvent, { type: 'done' }> => e.type === 'done');
    const errors = events.filter((e): e is Extract<RunEvent, { type: 'error' }> => e.type === 'error');
    const tools = events.filter((e) => e.type === 'tool-start').map((e) => (e as { toolName: string }).toolName);
    const reply = events.find((e): e is Extract<RunEvent, { type: 'reply' }> => e.type === 'reply');
    const expected = EXPECTED_TOOLS[id]?.[index] ?? [];
    const missing = missingTools(expected, tools);

    const problems: string[] = [];
    if (done?.outcome !== 'completed') problems.push(`outcome=${done?.outcome ?? '(none)'}`);
    for (const error of errors) problems.push(`error: ${error.message}`);
    if (!reply?.text) problems.push('返答が空');
    if (missing.length > 0) problems.push(`呼ばれなかったツール: ${missing.join(', ')}`);

    const label = `  ${problems.length === 0 ? '✓' : '✗'} "${oneLine(message).slice(0, 50)}" → [${tools.join(', ')}] ${done?.elapsedMs ?? '?'}ms`;
    console.log(label);
    if (problems.length > 0) {
      failures++;
      for (const problem of problems) console.log(`      ${problem}`);
    }
  }
}

console.log(failures === 0 ? '\nすべてのレッスンが正常に動きました。' : `\n${failures} 件の失敗があります。`);
process.exit(failures === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

function run(input: RunnerInput): Promise<RunEvent[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/_API_KEY$/.test(key)) delete env[key];
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', RUNNER], {
      cwd: input.workspace,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let stderr = '';
    (child.stdio[3] as NodeJS.ReadableStream).setEncoding('utf8');
    (child.stdio[3] as NodeJS.ReadableStream).on('data', (chunk: string) => (output += chunk));
    child.stderr!.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      const events = output
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunEvent);
      if (stderr.trim()) events.push({ type: 'log', level: 'stderr', text: stderr });
      resolve(events);
    });
    child.stdin!.end(JSON.stringify(input));
  });
}

function missingTools(expected: string[], actual: string[]): string[] {
  const remaining = [...actual];
  const missing: string[] = [];
  for (const name of expected) {
    const index = remaining.indexOf(name);
    if (index >= 0) remaining.splice(index, 1);
    else missing.push(name);
  }
  return missing;
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ');
}
