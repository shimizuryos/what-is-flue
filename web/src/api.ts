import type { RunEvent, RunRequestBody } from '../../server/protocol.ts';

export interface ServerStatus {
  realModeAvailable: boolean;
  providersWithKeys: string[];
  nodeVersion: string | null;
  flueVersion: string;
  /** Cloudflare Workers 上の公開版（コードは実行できず、記録の再生だけ）なら true */
  hosted?: boolean;
  repositoryUrl?: string;
}

export async function fetchStatus(): Promise<ServerStatus> {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()) as ServerStatus;
}

export async function resetWorkspace(clientId: string, lessonId: string): Promise<void> {
  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, lessonId }),
  });
}

/** POST /api/run の NDJSON ストリームを 1 イベントずつコールバックに渡す */
export async function runAgent(body: RunRequestBody, onEvent: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `サーバーエラー (${response.status})`;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // ignore
    }
    onEvent({ type: 'error', phase: 'server', message });
    onEvent({ type: 'done', outcome: 'error', elapsedMs: 0 });
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onEvent(JSON.parse(line) as RunEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as RunEvent);
}

// ---------------------------------------------------------------------------
// 公開版：サンプルメッセージの実行記録（CI が npm test -- --record で作る）を再生する

export interface Recording {
  lessonId: string;
  recordedAt: string;
  runs: { message: string; events: RunEvent[] }[];
}

const recordingCache = new Map<string, Promise<Recording | null>>();

export function fetchRecording(lessonId: string): Promise<Recording | null> {
  let cached = recordingCache.get(lessonId);
  if (!cached) {
    cached = fetch(`/recordings/${encodeURIComponent(lessonId)}.json`)
      .then((response) => (response.ok ? (response.json() as Promise<Recording>) : null))
      .catch(() => null);
    recordingCache.set(lessonId, cached);
  }
  return cached;
}

/** 記録したイベントを、実際の実行と同じように少しずつ流す */
const REPLAY_DELAY_MS: Partial<Record<RunEvent['type'], number>> = {
  status: 150,
  turn: 250,
  'text-delta': 12,
  'tool-start': 200,
  'tool-end': 250,
  'task-start': 200,
  data: 150,
  http: 250,
};

export async function replayEvents(events: RunEvent[], onEvent: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
  for (const event of events) {
    await new Promise((resolve) => setTimeout(resolve, REPLAY_DELAY_MS[event.type] ?? 60));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onEvent(event);
  }
}
