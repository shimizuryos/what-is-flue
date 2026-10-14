// モックLLM：APIキーなしで Flue エージェントを「本物のランタイム」で動かすための偽モデル。
//
// Pi（Flue の基盤）が提供する faux provider に「応答を組み立てる関数」を渡しています。
// 関数はモデルに送られてきた会話（システムプロンプト・履歴・ツール一覧）を読み、
// 決まったルールでツール呼び出しか返答テキストを返します。
//
// ルール（UI とレッスンでも説明しています）:
//   1. メッセージに `$ <コマンド>` の行があり bash ツールがあれば、そのコマンドを bash で実行する
//   2. メッセージにツール名（例: lookup_order）が含まれていれば、そのツールを呼ぶ
//   3. メッセージにスキル名・サブエージェント名が含まれていれば activate_skill / task を呼ぶ
//   4. `/call ツール名 {"引数": "JSON"}` で任意のツールを明示的に呼べる
//   5. 構造化出力（finish ツール）が求められていれば、スキーマに合う値で finish を呼ぶ
//   6. やることが無くなったら、見えている情報を説明するテキストで返答する

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Provider,
} from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface ToolDef {
  name: string;
  description: string;
  parameters?: JsonSchema;
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: Json[];
  const?: Json;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  description?: string;
  default?: Json;
  minimum?: number;
}

// faux provider に渡ってくるメッセージ（必要な部分だけ）
interface AnyMessage {
  role: 'system' | 'user' | 'assistant' | 'toolResult';
  content: unknown;
  toolsAdded?: ToolDef[];
  toolsRemoved?: { name: string }[];
  sections?: Record<string, string | null>;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

interface PlannedCall {
  name: string;
  args: JsonObject;
}

/** ランナー起動時に Flue の全組み込みプロバイダー ID をモックで置き換える */
export function createMockProviders(): Provider[] {
  return builtinProviders().map((builtin) => {
    const models = builtin.getModels();
    const handle = fauxProvider({
      provider: builtin.id,
      api: `mock-${builtin.id}`,
      models: (models.length > 0 ? models : [{ id: 'mock', contextWindow: 128000, maxTokens: 8192 }]).map(
        (model) => ({
          id: model.id,
          name: `${model.id} (mock)`,
          reasoning: false,
          input: ['text', 'image'] as ('text' | 'image')[],
          contextWindow: model.contextWindow || 128000,
          maxTokens: model.maxTokens || 8192,
        }),
      ),
      // 少しずつ文字が流れてくる様子が見えるようにストリーミング速度を設定
      tokensPerSecond: 160,
    });
    // faux provider は「応答の待ち行列」を 1 回の呼び出しごとに 1 つ消費する。
    // 応答関数が自分自身を補充することで、何回呼ばれても尽きないようにする。
    const step = (context: { messages: unknown[] }) => {
      handle.appendResponses([step]);
      return respond(context.messages as AnyMessage[]);
    };
    handle.setResponses(Array.from({ length: 16 }, () => step));
    return handle.provider;
  });
}

// ---------------------------------------------------------------------------
// 応答の組み立て

const FRAMEWORK_TOOLS = new Set(['task', 'activate_skill', 'read_skill_resource', 'finish', 'give_up']);
const SANDBOX_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'grep', 'glob']);

function respond(messages: AnyMessage[]) {
  const view = analyze(messages);
  const plan = planCalls(view);
  const next = nextCall(plan, view.callsSinceRequest);

  if (next) {
    return fauxAssistantMessage([fauxToolCall(next.name, next.args)], { stopReason: 'toolUse' });
  }
  return fauxAssistantMessage([fauxText(composeReply(view))]);
}

interface TranscriptView {
  systemPrompt: string;
  tools: Map<string, ToolDef>;
  request: string;
  requestIsSignal: boolean;
  previousRequests: string[];
  contextSignals: string[];
  callsSinceRequest: { name: string; args: unknown }[];
  resultsSinceRequest: { name: string; text: string; isError: boolean }[];
}

function analyze(messages: AnyMessage[]): TranscriptView {
  let systemPrompt = '';
  const sections: Record<string, string> = {};
  const tools = new Map<string, ToolDef>();
  const requests: { index: number; text: string; signal: boolean }[] = [];

  messages.forEach((message, index) => {
    if (message.role === 'system') {
      const text = contentText(message.content);
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
      for (const [name, value] of Object.entries(message.sections ?? {})) {
        if (value === null) delete sections[name];
        else sections[name] = value;
      }
      for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
      for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
      return;
    }
    if (message.role === 'user') {
      const text = contentText(message.content);
      // Flue がツール・スキル構成の変化を知らせる通知は「依頼」ではないので除外する
      if (isResourceAnnouncement(text)) return;
      requests.push({ index, text, signal: /^\s*<[\w.-]+[\s>]/.test(text) });
    }
  });

  // 「今回の入力」= 最後のアシスタント発言より後に届いたユーザー発言・シグナルのまとまり。
  // useAgentStart の append() で足されたシグナルは、ユーザーの発言に添えられた「文脈」として扱う。
  let groupStart = Math.max(0, requests.length - 1);
  while (groupStart > 0) {
    const between = messages.slice(requests[groupStart - 1]!.index + 1, requests[groupStart]!.index);
    if (between.some((m) => m.role === 'assistant' || m.role === 'toolResult')) break;
    groupStart--;
  }
  const group = requests.slice(groupStart);
  const current = [...group].reverse().find((r) => !r.signal) ?? group.at(-1);
  const contextSignals = group.filter((r) => r.signal && r !== current).map((r) => r.text);
  const lastOfGroup = group.at(-1);
  const after = lastOfGroup ? messages.slice(lastOfGroup.index + 1) : [];
  const callsSinceRequest: TranscriptView['callsSinceRequest'] = [];
  const resultsSinceRequest: TranscriptView['resultsSinceRequest'] = [];
  for (const message of after) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content as { type: string; name?: string; arguments?: unknown }[]) {
        if (block.type === 'toolCall' && block.name) callsSinceRequest.push({ name: block.name, args: block.arguments });
      }
    }
    if (message.role === 'toolResult') {
      resultsSinceRequest.push({
        name: message.toolName ?? '?',
        text: contentText(message.content),
        isError: Boolean(message.isError),
      });
    }
  }

  const fullSystem = [systemPrompt, ...Object.values(sections)].filter(Boolean).join('\n\n');
  return {
    systemPrompt: fullSystem,
    tools,
    request: current?.text ?? '',
    requestIsSignal: current?.signal ?? false,
    previousRequests: requests.slice(0, groupStart).filter((r) => !r.signal).map((r) => r.text),
    contextSignals,
    callsSinceRequest,
    resultsSinceRequest,
  };
}

/** Flue 自身がエージェントの構成変化を知らせるシグナル（resources / instructions / environment）か */
function isResourceAnnouncement(text: string): boolean {
  return /^\s*<[\w.-]+\s[^>]*type="(resources|instructions|environment)"/.test(text);
}

function planCalls(view: TranscriptView): PlannedCall[] {
  const text = view.request;
  const mentions: { at: number; call: PlannedCall }[] = [];

  // 4. /call tool {json}
  for (const match of text.matchAll(/\/call\s+([\w-]+)\s*(\{[^\n]*\})?/g)) {
    const name = match[1]!;
    if (!view.tools.has(name)) continue;
    const args = parseJsonObject(match[2]) ?? inferArgs(view.tools.get(name)!.parameters, text, name, {});
    mentions.push({ at: match.index ?? 0, call: { name, args } });
  }
  const explicit = mentions.length > 0;

  // 1. `$ command` → bash
  if (!explicit && view.tools.has('bash')) {
    for (const match of text.matchAll(/^\s*\$\s+(.+)$/gm)) {
      mentions.push({ at: match.index ?? 0, call: { name: 'bash', args: { command: match[1]!.trim() } } });
    }
  }

  // 2. ツール名の言及
  if (!explicit) {
    for (const tool of view.tools.values()) {
      if (FRAMEWORK_TOOLS.has(tool.name) || SANDBOX_TOOLS.has(tool.name)) continue;
      const at = findMention(text, tool.name);
      if (at < 0) continue;
      mentions.push({ at, call: { name: tool.name, args: inferArgs(tool.parameters, text, tool.name, {}) } });
    }
  }

  // 3. スキル / サブエージェントの言及（システムプロンプトの一覧から名前を拾う）
  if (!explicit && view.tools.has('activate_skill')) {
    for (const skill of listedNames(view.systemPrompt, 'Available Skills')) {
      const at = findMention(text, skill);
      if (at < 0) continue;
      mentions.push({ at, call: { name: 'activate_skill', args: { name: skill } } });
    }
  }
  if (!explicit && view.tools.has('task')) {
    for (const agent of listedNames(view.systemPrompt, 'Available Agents')) {
      const at = findMention(text, agent);
      if (at < 0) continue;
      const quoted = text.match(/[「"“]([^」"”]+)[」"”]/)?.[1];
      const args: JsonObject = { description: `${agent} に依頼`, agent, prompt: quoted ?? text };
      mentions.push({ at, call: { name: 'task', args } });
    }
  }

  mentions.sort((a, b) => a.at - b.at);
  const plan = mentions.map((m) => m.call);

  // 5. 構造化出力：最後に finish を呼ぶ
  if (view.tools.has('finish')) {
    plan.push({ name: 'finish', args: inferArgs(view.tools.get('finish')!.parameters, text, 'finish', {}) });
  }
  return plan;
}

/** 計画のうち、まだ実行していない最初の呼び出しを返す */
function nextCall(plan: PlannedCall[], done: { name: string }[]): PlannedCall | undefined {
  const remaining = [...done];
  for (const call of plan) {
    const index = remaining.findIndex((d) => d.name === call.name);
    if (index >= 0) {
      remaining.splice(index, 1);
      continue;
    }
    return call;
  }
  return undefined;
}

function composeReply(view: TranscriptView): string {
  const lines: string[] = [];
  if (view.resultsSinceRequest.length > 0) {
    lines.push('（モックLLM）ツールの結果を受け取りました。');
    for (const result of view.resultsSinceRequest) {
      const label = result.isError ? 'エラー' : '結果';
      lines.push(`- \`${result.name}\` の${label}: ${truncate(oneLine(result.text), 240)}`);
    }
    lines.push('', '本物のLLMなら、この結果を読んで自然な文章で答えます。');
    return lines.join('\n');
  }

  const toolNames = [...view.tools.keys()];
  const custom = toolNames.filter((name) => !FRAMEWORK_TOOLS.has(name) && !SANDBOX_TOOLS.has(name));
  const kind = view.requestIsSignal ? 'シグナル（イベント）' : 'メッセージ';
  lines.push(`（モックLLM）${kind}「${truncate(oneLine(view.request), 120)}」を受け取りました。`);
  lines.push('');
  for (const signal of view.contextSignals) {
    lines.push(`- 一緒に届いたシグナル: ${truncate(oneLine(signal), 120)}`);
  }
  lines.push(`- 指示（システムプロンプトの先頭）: 「${truncate(oneLine(view.systemPrompt), 100)}」`);
  lines.push(`- 使えるツール: ${toolNames.length > 0 ? toolNames.map((n) => `\`${n}\``).join(', ') : 'なし'}`);
  if (view.previousRequests.length > 0) {
    lines.push(
      `- この会話の履歴: これまでに ${view.previousRequests.length} 件のメッセージを覚えています（直前: 「${truncate(oneLine(view.previousRequests.at(-1)!), 60)}」）`,
    );
  } else {
    lines.push('- この会話の履歴: これが最初のメッセージです');
  }
  if (custom.length > 0) {
    lines.push('', `💡 ツールを呼ばせるには、メッセージにツール名（例: \`${custom[0]}\`）を含めてください。`);
  } else if (view.tools.has('bash')) {
    lines.push('', '💡 `$ ls -la` のように `$` で始まる行を送ると bash ツールで実行します。');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 引数の推測

function inferArgs(
  schema: JsonSchema | undefined,
  text: string,
  mentionedName: string,
  hints: JsonObject,
): JsonObject {
  const explicit = parseJsonObject(text.match(/\{[^{}]*\}/)?.[0]);
  if (explicit) return { ...hints, ...explicit };

  const resolved = unwrap(schema);
  const props = resolved?.properties ?? {};
  const required = new Set(resolved?.required ?? []);
  const cleaned = text.split(mentionedName).join(' ');
  const args: JsonObject = {};
  for (const [key, prop] of Object.entries(props)) {
    if (key in hints) {
      args[key] = hints[key]!;
      continue;
    }
    // 任意（optional）の引数は省略し、必須の引数だけを埋める
    if (!required.has(key)) continue;
    const value = inferValue(key, unwrap(prop), cleaned);
    if (value !== undefined) args[key] = value;
  }
  return args;
}

function inferValue(key: string, schema: JsonSchema | undefined, text: string): Json | undefined {
  if (!schema) return undefined;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum && schema.enum.length > 0) {
    const hit = schema.enum.find((option) => typeof option === 'string' && text.includes(option));
    return hit ?? schema.enum[0]!;
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'number':
    case 'integer': {
      const number = text.replace(/[A-Za-z]+[-_]?\d[\w-]*/g, ' ').match(/-?\d+(?:\.\d+)?/);
      const value = number ? Number(number[0]) : (schema.minimum ?? 1);
      return type === 'integer' ? Math.round(value) : value;
    }
    case 'boolean':
      return true;
    case 'array': {
      const item = inferValue(key, unwrap(schema.items), text);
      return item === undefined ? [] : [item];
    }
    case 'object':
      return inferArgs(schema, text, '', {});
    case 'string':
    default: {
      const quoted = text.match(/[「"“]([^」"”]+)[」"”]/)?.[1];
      const idLike = text.match(/[A-Za-z]+[-_]?\d[\w-]*/)?.[0];
      if (/id$/i.test(key) && idLike) return idLike;
      if (quoted) return quoted;
      if (idLike) return idLike;
      const rest = text.replace(/(を|で|に|は|の)?\s*(調べて|使って|呼んで|実行して|ください|して)[。.!！]*$/u, '').trim();
      return truncate(oneLine(rest), 80) || (typeof schema.default === 'string' ? schema.default : key);
    }
  }
}

function unwrap(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return variants.find((v) => v.type !== 'null') ?? variants[0];
  return schema;
}

/** システムプロンプトの「## Available Skills」「## Available Agents」節から名前の一覧を取り出す */
function listedNames(systemPrompt: string, heading: string): string[] {
  const start = systemPrompt.indexOf(`## ${heading}`);
  if (start < 0) return [];
  const rest = systemPrompt.slice(start + heading.length + 3);
  const end = rest.search(/\n##\s/);
  const section = end >= 0 ? rest.slice(0, end) : rest;
  return [...section.matchAll(/^\s*[-*]\s+\*\*([^*]+)\*\*/gm)].map((match) => match[1]!.trim());
}

function findMention(text: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'i').exec(text);
  return match ? match.index + match[1]!.length : -1;
}

// ---------------------------------------------------------------------------
// 小物

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: { type?: string; text?: string; mimeType?: string }) => {
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'image') return `[画像 ${block.mimeType ?? ''}]`;
      return '';
    })
    .join('\n');
}

function parseJsonObject(text: string | undefined): JsonObject | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
  } catch {
    return undefined;
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
