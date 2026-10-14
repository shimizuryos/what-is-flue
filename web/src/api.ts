import type { RunEvent, RunRequestBody } from '../../server/protocol.ts';

export interface ServerStatus {
  realModeAvailable: boolean;
  providersWithKeys: string[];
  nodeVersion: string;
  flueVersion: string;
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
