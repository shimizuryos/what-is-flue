import { useEffect, useState } from 'react';
import type { TraceItem } from '../exchange.ts';

type TurnItem = Extract<TraceItem, { kind: 'turn' }>;
type Tab = 'system' | 'tools' | 'messages';

const ROLE_LABEL: Record<string, string> = {
  user: '👤 user',
  assistant: '🤖 assistant',
  toolResult: '🔧 toolResult',
  system: '⚙️ system',
};

/** 1 回のモデル呼び出しで LLM に送られた内容（observe() の turn_request イベント）を見せる */
export function InspectorDialog({ item, onClose }: { item: TurnItem; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('system');
  const { turn } = item;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="inspector-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <h2 id="inspector-title">🔍 モデルへの入力</h2>
            <p className="muted small">
              {turn.model}
              {turn.taskId ? ' · サブエージェントの会話' : turn.harness ? ' · harness.prompt() の会話' : ''} · Flue の observe() で取得した
              turn_request イベント
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'system'} className={tab === 'system' ? 'active' : ''} onClick={() => setTab('system')}>
            システムプロンプト
          </button>
          <button type="button" role="tab" aria-selected={tab === 'tools'} className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>
            ツール（{turn.tools.length}）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'messages'}
            className={tab === 'messages' ? 'active' : ''}
            onClick={() => setTab('messages')}
          >
            会話履歴（{turn.messages.length}）
          </button>
        </div>
        <div className="dialog-body">
          {tab === 'system' && (
            <>
              <p className="hint">エージェント関数の戻り値（指示）に、Flue がスキル・サブエージェント一覧や作業ディレクトリなどを追記したものです。</p>
              <pre className="prompt">{turn.systemPrompt || '(なし)'}</pre>
            </>
          )}
          {tab === 'tools' && (
            <>
              <p className="hint">モデルが見ているのは name・description・parameters（JSON Schema）だけです。</p>
              <ul className="tool-list">
                {turn.tools.map((tool) => (
                  <li key={tool.name}>
                    <div className="tool-name">
                      <code>{tool.name}</code>
                      {FRAMEWORK.has(tool.name) && <span className="tag">Flue 組み込み</span>}
                      {SANDBOX.has(tool.name) && <span className="tag">サンドボックス</span>}
                    </div>
                    <p className="tool-description">{tool.description}</p>
                    <details>
                      <summary>parameters</summary>
                      <pre className="json">{JSON.stringify(tool.parameters ?? {}, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tab === 'messages' && (
            <>
              <p className="hint">この会話でこれまでに起きたこと。同じ会話IDで送ると、過去のやりとりもここに含まれます。</p>
              <ol className="message-list">
                {turn.messages.map((message, index) => (
                  <li key={index} className={`message role-${message.role}`}>
                    <div className="message-role">{ROLE_LABEL[message.role] ?? message.role}</div>
                    <pre>{message.text}</pre>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const FRAMEWORK = new Set(['task', 'activate_skill', 'read_skill_resource', 'finish', 'give_up']);
const SANDBOX = new Set(['read', 'write', 'edit', 'bash', 'grep', 'glob']);
