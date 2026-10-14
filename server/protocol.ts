// ブラウザ ⇄ サーバー ⇄ ランナー（子プロセス）でやり取りする型の定義。
// ランナーは 1 行 1 イベントの NDJSON を出力し、サーバーはそれをそのままブラウザへ流します。

export type RunMode = 'mock' | 'real';

/** ブラウザから POST /api/run に送る内容 */
export interface RunRequestBody {
  clientId: string;
  lessonId: string;
  /** プロジェクト相対パス → ファイル内容 */
  files: Record<string, string>;
  /** 実行するエージェントモジュール（例: src/agents/assistant.ts） */
  entry: string;
  /** モジュールが複数のエージェントを export しているときの選択 */
  agentName?: string;
  conversationId: string;
  message: string;
  /** useInitialData() に渡す JSON 文字列（会話の初回作成時のみ有効） */
  initialData?: string;
  mode: RunMode;
  /** true のとき entry を app.ts として扱い、HTTP 経由でエージェントに話しかける */
  http?: { mountPath: string };
}

/** サーバーがランナーに渡す内容 */
export interface RunnerInput {
  workspace: string;
  entry: string;
  agentName?: string;
  conversationId: string;
  message: string;
  initialData?: unknown;
  mode: RunMode;
  http?: { mountPath: string };
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters?: unknown;
}

export interface ModelMessageView {
  role: string;
  text: string;
}

export type RunEvent =
  | { type: 'status'; text: string }
  | { type: 'meta'; agentName: string; conversationId: string; mode: RunMode; cli: string; warnings: string[] }
  | { type: 'log'; level: string; text: string }
  | {
      type: 'turn';
      turnId: string;
      taskId?: string;
      /** harness.prompt() など、ツール内の別会話で行われたターンのとき harness 名 */
      harness?: string;
      model: string;
      systemPrompt: string;
      tools: ToolInfo[];
      messages: ModelMessageView[];
    }
  | { type: 'turn-end'; turnId: string; taskId?: string; durationMs: number; finishReason?: string; tokens?: number; error?: string }
  | { type: 'text-delta'; turnId?: string; taskId?: string; harness?: string; text: string }
  | { type: 'tool-start'; toolCallId: string; taskId?: string; harness?: string; toolName: string; args: unknown }
  | { type: 'tool-end'; toolCallId: string; taskId?: string; harness?: string; toolName: string; isError: boolean; result: unknown; durationMs: number }
  | { type: 'tool-log'; toolCallId?: string; taskId?: string; level: string; text: string }
  | { type: 'task-start'; taskId: string; agent?: string; prompt: string }
  | { type: 'task-end'; taskId: string; agent?: string; isError: boolean; result: unknown; durationMs: number }
  | { type: 'data'; name: string; data: unknown }
  | { type: 'http'; method: string; url: string; requestBody?: unknown; status: number; responseBody: unknown }
  | {
      type: 'reply';
      text: string;
      data: Record<string, unknown[]>;
      metadata?: Record<string, unknown>;
      submissionId: string;
      uid?: string;
    }
  | { type: 'error'; phase: 'load' | 'run' | 'server'; message: string; detail?: string; hint?: string }
  | { type: 'done'; outcome: 'completed' | 'failed' | 'aborted' | 'error'; elapsedMs: number };
