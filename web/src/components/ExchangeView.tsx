import { useState } from 'react';
import type { Exchange, ExchangeSummary, TraceItem } from '../exchange.ts';
import { InspectorDialog } from './InspectorDialog.tsx';

type TurnItem = Extract<TraceItem, { kind: 'turn' }>;

export function ExchangeView({ exchange, defaultOpen }: { exchange: Exchange; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [inspecting, setInspecting] = useState<TurnItem | null>(null);

  const errors = exchange.items.filter((i): i is Extract<TraceItem, { kind: 'error' }> => i.kind === 'error');
  const dataItems = exchange.items.filter((i): i is Extract<TraceItem, { kind: 'data' }> => i.kind === 'data');
  const httpItems = exchange.items.filter((i): i is Extract<TraceItem, { kind: 'http' }> => i.kind === 'http');
  const turns = exchange.items.filter((i): i is TurnItem => i.kind === 'turn');
  const toolCount = exchange.items.filter((i) => i.kind === 'tool').length;
  const replyText = exchange.reply?.text ?? exchange.streamingText;
  const metadata = exchange.reply?.metadata;
  const lastTopTurn = [...turns].reverse().find((t) => !t.turn.taskId && !t.turn.harness);

  return (
    <div className="exchange" data-exchange-id={exchange.id}>
      <div className="bubble user-bubble">
        <div className="bubble-text">{exchange.message}</div>
        <div className="bubble-meta">
          {exchange.conversationId} ·{' '}
          {exchange.replay ? '📼 記録を再生（モックLLM）' : exchange.mode === 'mock' ? '🤖 モック' : '✨ 本物のLLM'}
        </div>
      </div>

      <div className={`bubble agent-bubble status-${exchange.status}`}>
        {exchange.meta && <div className="agent-name">🧩 {exchange.meta.agentName}</div>}
        {exchange.meta?.warnings.map((warning) => (
          <p key={warning} className="warning">
            ⚠️ {warning}
          </p>
        ))}
        {replyText ? (
          <div className="bubble-text">
            {replyText}
            {exchange.status === 'running' && <span className="cursor" aria-hidden="true" />}
          </div>
        ) : exchange.status === 'running' ? (
          <div className="thinking">
            <span className="spinner" aria-hidden="true" /> {exchange.statusText ?? '実行中…'}
          </div>
        ) : null}

        {errors.map((error) => (
          <div key={error.id} className="error-box">
            <strong>
              {error.event.phase === 'load' ? 'コードの読み込みに失敗しました' : error.event.phase === 'server' ? 'サーバーエラー' : '実行中にエラーが起きました'}
            </strong>
            <pre>{error.event.message}</pre>
            {error.event.hint && <p className="error-hint">💡 {error.event.hint}</p>}
            {error.event.detail && (
              <details>
                <summary>詳細</summary>
                <pre>{error.event.detail}</pre>
              </details>
            )}
          </div>
        ))}

        {httpItems.length > 0 && (
          <div className="result-section">
            <div className="section-label">🌐 HTTP</div>
            {httpItems.map((item) => (
              <details key={item.id} className="http-item" open>
                <summary>
                  <code>
                    {item.event.method} {item.event.url}
                  </code>{' '}
                  → <span className={`http-status s${String(item.event.status)[0]}`}>{item.event.status}</span>
                </summary>
                {item.event.requestBody !== undefined && (
                  <>
                    <div className="mini-label">リクエスト</div>
                    <pre className="json">{json(item.event.requestBody)}</pre>
                  </>
                )}
                <div className="mini-label">レスポンス</div>
                <pre className="json">{json(item.event.responseBody, 3000)}</pre>
              </details>
            ))}
          </div>
        )}

        {dataItems.length > 0 && (
          <div className="result-section">
            <div className="section-label">📦 データ（useDataWriter）</div>
            {dataItems.map((item) => (
              <div key={item.id} className="data-item">
                <code>data-{item.name}</code> <span className="json-inline">{json(item.data)}</span>
              </div>
            ))}
          </div>
        )}

        {metadata && Object.keys(metadata).length > 0 && (
          <div className="result-section">
            <div className="section-label">🏷 メタデータ（useResponseStart / useResponseFinish）</div>
            <pre className="json">{json(metadata)}</pre>
          </div>
        )}

        <div className="exchange-footer">
          <button type="button" className="link-button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? '▾' : '▸'} 実行の詳細（モデル呼び出し {turns.length} 回・ツール {toolCount} 回）
          </button>
          {lastTopTurn && (
            <button type="button" className="inspect-button" onClick={() => setInspecting(lastTopTurn)}>
              🔍 モデルへの入力
            </button>
          )}
          <span className="elapsed">
            {exchange.status === 'running' ? '' : `${statusLabel(exchange.status)}${exchange.elapsedMs ? ` · ${(exchange.elapsedMs / 1000).toFixed(1)}秒` : ''}`}
          </span>
        </div>

        {open && <TraceView exchange={exchange} onInspect={setInspecting} />}
      </div>

      {inspecting && <InspectorDialog item={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}

export function PastExchangeView({ summary }: { summary: ExchangeSummary }) {
  return (
    <div className="exchange past">
      <div className="bubble user-bubble">
        <div className="bubble-text">{summary.message}</div>
      </div>
      <div className={`bubble agent-bubble status-${summary.status}`}>
        {summary.replyText && <div className="bubble-text">{summary.replyText}</div>}
        {summary.errorText && <div className="error-box"><pre>{summary.errorText}</pre></div>}
      </div>
    </div>
  );
}

function TraceView({ exchange, onInspect }: { exchange: Exchange; onInspect: (item: TurnItem) => void }) {
  let turnNumber = 0;
  return (
    <div className="trace">
      {exchange.meta && (
        <div className="trace-cli">
          <div className="mini-label">{exchange.meta.cli.startsWith('curl') ? '同じことをする HTTP リクエスト' : 'この実行と同じ CLI コマンド'}</div>
          <code>{exchange.meta.cli}</code>
        </div>
      )}
      <ol className="trace-list">
        {exchange.items.map((item) => {
          switch (item.kind) {
            case 'turn': {
              turnNumber++;
              const scope = scopeOf(item.turn.taskId, item.turn.harness);
              return (
                <li key={item.id} className={`trace-item turn ${scope ? 'nested' : ''}`}>
                  <div className="trace-head">
                    {scope && <span className="scope-badge">{scope}</span>}
                    <span>🧠 モデル呼び出し #{turnNumber}</span>
                    <span className="muted small">
                      {item.turn.model}
                      {item.end ? ` · ${item.end.durationMs}ms` : ' · 実行中…'}
                      {item.end?.finishReason ? ` · ${finishLabel(item.end.finishReason)}` : ''}
                    </span>
                    <button type="button" className="inspect-button small" onClick={() => onInspect(item)}>
                      🔍 モデルへの入力
                    </button>
                  </div>
                  {item.end?.error && <div className="trace-error">{item.end.error}</div>}
                  {item.text && <div className="trace-text">{item.text}</div>}
                </li>
              );
            }
            case 'tool': {
              const scope = scopeOf(item.start.taskId, item.start.harness);
              return (
                <li key={item.id} className={`trace-item tool ${scope ? 'nested' : ''} ${item.end?.isError ? 'is-error' : ''}`}>
                  <div className="trace-head">
                    {scope && <span className="scope-badge">{scope}</span>}
                    <span>
                      🔧 ツール <code>{item.start.toolName}</code>
                    </span>
                    <span className="muted small">{item.end ? `${item.end.durationMs}ms` : '実行中…'}</span>
                  </div>
                  <div className="kv">
                    <span className="mini-label">引数</span>
                    <pre className="json">{json(item.start.args ?? {})}</pre>
                  </div>
                  {item.end && (
                    <div className="kv">
                      <span className="mini-label">{item.end.isError ? 'エラー' : '結果'}</span>
                      <pre className={`json ${item.end.isError ? 'error-text' : ''}`}>{json(item.end.result, 2000)}</pre>
                    </div>
                  )}
                </li>
              );
            }
            case 'task':
              return (
                <li key={item.id} className="trace-item task">
                  <div className="trace-head">
                    <span>
                      🤝 サブエージェント <code>{item.start.agent ?? '(general)'}</code> に委任
                    </span>
                    <span className="muted small">{item.end ? `${item.end.durationMs}ms` : '実行中…'}</span>
                  </div>
                  <div className="kv">
                    <span className="mini-label">prompt</span>
                    <pre className="json">{item.start.prompt}</pre>
                  </div>
                  {item.end && (
                    <div className="kv">
                      <span className="mini-label">返ってきた答え</span>
                      <pre className="json">{typeof item.end.result === 'string' ? item.end.result : json(item.end.result)}</pre>
                    </div>
                  )}
                </li>
              );
            case 'log':
              return (
                <li key={item.id} className={`trace-item log level-${item.level}`}>
                  <span className="log-source">{item.source === 'console' ? `console.${item.level}` : `log.${item.level}`}</span>
                  <span className="log-text">{item.text}</span>
                </li>
              );
            case 'data':
              return (
                <li key={item.id} className="trace-item data">
                  📦 <code>data-{item.name}</code> <span className="json-inline">{json(item.data)}</span>
                </li>
              );
            case 'http':
              return (
                <li key={item.id} className="trace-item http">
                  🌐 <code>
                    {item.event.method} {item.event.url}
                  </code>{' '}
                  → {item.event.status}
                </li>
              );
            case 'error':
              return (
                <li key={item.id} className="trace-item error">
                  ❌ {item.event.message}
                </li>
              );
          }
        })}
        {exchange.status === 'running' && (
          <li className="trace-item pending">
            <span className="spinner" aria-hidden="true" /> {exchange.statusText ?? '実行中…'}
          </li>
        )}
      </ol>
    </div>
  );
}

function scopeOf(taskId?: string, harness?: string): string | undefined {
  if (taskId) return '🤝 サブエージェント';
  if (harness) return `🧰 harness`;
  return undefined;
}

function finishLabel(reason: string): string {
  if (reason === 'toolUse') return 'ツールを呼ぶ';
  if (reason === 'stop') return '返答完了';
  return reason;
}

function statusLabel(status: Exchange['status']): string {
  return { running: '実行中', completed: '✓ 完了', failed: '✗ 失敗', aborted: '■ 停止', error: '✗ エラー' }[status];
}

export function json(value: unknown, max = 1200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text === undefined) return String(value);
  return text.length > max ? `${text.slice(0, max)}\n…（${text.length - max} 文字省略）` : text;
}
