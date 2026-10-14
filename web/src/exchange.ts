// 1 回の実行（メッセージ送信 → 返答）を表すデータと、ランナーのイベントを畳み込む reducer。
import type { RunEvent, RunMode } from '../../server/protocol.ts';

type EventOf<T extends RunEvent['type']> = Extract<RunEvent, { type: T }>;

export type TraceItem =
  | { kind: 'turn'; id: string; turn: EventOf<'turn'>; end?: EventOf<'turn-end'>; text: string }
  | { kind: 'tool'; id: string; start: EventOf<'tool-start'>; end?: EventOf<'tool-end'> }
  | { kind: 'task'; id: string; start: EventOf<'task-start'>; end?: EventOf<'task-end'> }
  | { kind: 'log'; id: string; level: string; text: string; taskId?: string; source: 'console' | 'flue' }
  | { kind: 'data'; id: string; name: string; data: unknown }
  | { kind: 'http'; id: string; event: EventOf<'http'> }
  | { kind: 'error'; id: string; event: EventOf<'error'> };

export type ExchangeStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'error';

export interface Exchange {
  id: string;
  message: string;
  conversationId: string;
  mode: RunMode;
  startedAt: number;
  status: ExchangeStatus;
  statusText?: string;
  meta?: EventOf<'meta'>;
  items: TraceItem[];
  /** 親エージェントのモデルが書いた文章（ストリーミング中） */
  streamingText: string;
  reply?: EventOf<'reply'>;
  elapsedMs?: number;
}

/** リロード後も会話の流れを表示するための軽量版（詳細なトレースは保存しない） */
export interface ExchangeSummary {
  id: string;
  message: string;
  conversationId: string;
  mode: RunMode;
  status: ExchangeStatus;
  replyText: string;
  errorText?: string;
}

export function createExchange(message: string, conversationId: string, mode: RunMode): Exchange {
  return {
    id: crypto.randomUUID(),
    message,
    conversationId,
    mode,
    startedAt: Date.now(),
    status: 'running',
    statusText: '送信中…',
    items: [],
    streamingText: '',
  };
}

let counter = 0;
const nextId = () => `i${++counter}`;

export function applyEvent(exchange: Exchange, event: RunEvent): Exchange {
  const next: Exchange = { ...exchange };
  switch (event.type) {
    case 'status':
      next.statusText = event.text;
      return next;
    case 'meta':
      next.meta = event;
      return next;
    case 'log':
      next.items = [...exchange.items, { kind: 'log', id: nextId(), level: event.level, text: event.text, source: 'console' }];
      return next;
    case 'tool-log':
      next.items = [
        ...exchange.items,
        { kind: 'log', id: nextId(), level: event.level, text: event.text, taskId: event.taskId, source: 'flue' },
      ];
      return next;
    case 'turn':
      next.statusText = event.taskId ? 'サブエージェントが考え中…' : 'モデルが考え中…';
      next.items = [...exchange.items, { kind: 'turn', id: event.turnId, turn: event, text: '' }];
      return next;
    case 'turn-end':
      next.items = exchange.items.map((item) =>
        item.kind === 'turn' && item.id === event.turnId ? { ...item, end: event } : item,
      );
      return next;
    case 'text-delta': {
      if (!event.taskId && !event.harness) next.streamingText = exchange.streamingText + event.text;
      const index = findLastIndex(exchange.items, (item) => item.kind === 'turn' && (!event.turnId || item.id === event.turnId));
      if (index >= 0) {
        const items = [...exchange.items];
        const item = items[index] as Extract<TraceItem, { kind: 'turn' }>;
        items[index] = { ...item, text: item.text + event.text };
        next.items = items;
      }
      return next;
    }
    case 'tool-start':
      next.statusText = `ツール ${event.toolName} を実行中…`;
      next.items = [...exchange.items, { kind: 'tool', id: event.toolCallId, start: event }];
      return next;
    case 'tool-end':
      next.items = exchange.items.map((item) =>
        item.kind === 'tool' && item.id === event.toolCallId ? { ...item, end: event } : item,
      );
      return next;
    case 'task-start':
      next.items = [...exchange.items, { kind: 'task', id: event.taskId, start: event }];
      return next;
    case 'task-end':
      next.items = exchange.items.map((item) =>
        item.kind === 'task' && item.id === event.taskId ? { ...item, end: event } : item,
      );
      return next;
    case 'data':
      next.items = [...exchange.items, { kind: 'data', id: nextId(), name: event.name, data: event.data }];
      return next;
    case 'http':
      next.items = [...exchange.items, { kind: 'http', id: nextId(), event }];
      return next;
    case 'reply':
      next.reply = event;
      return next;
    case 'error':
      next.items = [...exchange.items, { kind: 'error', id: nextId(), event }];
      return next;
    case 'done':
      next.status = event.outcome;
      next.elapsedMs = event.elapsedMs;
      next.statusText = undefined;
      return next;
  }
}

export function summarize(exchange: Exchange): ExchangeSummary {
  const error = exchange.items.find((item): item is Extract<TraceItem, { kind: 'error' }> => item.kind === 'error');
  return {
    id: exchange.id,
    message: exchange.message,
    conversationId: exchange.conversationId,
    mode: exchange.mode,
    status: exchange.status === 'running' ? 'aborted' : exchange.status,
    replyText: exchange.reply?.text ?? exchange.streamingText,
    errorText: error?.event.message,
  };
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i]!)) return i;
  return -1;
}
