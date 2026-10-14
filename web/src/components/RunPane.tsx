import { useEffect, useRef, useState } from 'react';
import type { RunMode } from '../../../server/protocol.ts';
import type { Exchange, ExchangeSummary } from '../exchange.ts';
import type { Lesson } from '../lesson-format.ts';
import { randomId } from '../storage.ts';
import { ExchangeView, PastExchangeView } from './ExchangeView.tsx';

export function RunPane(props: {
  lesson: Lesson;
  mode: RunMode;
  conversationId: string;
  onConversationChange: (id: string) => void;
  initialData: string;
  onInitialDataChange: (value: string) => void;
  mountPath: string;
  onMountPathChange: (value: string) => void;
  pastHistory: ExchangeSummary[];
  exchanges: Exchange[];
  draft: string;
  onDraftChange: (value: string) => void;
  running: boolean;
  onRun: (message: string) => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const { lesson } = props;
  const [showSettings, setShowSettings] = useState(Boolean(lesson.initialData || lesson.http));
  const listRef = useRef<HTMLDivElement>(null);
  const conversationOk = /^[\w.:-]{1,128}$/.test(props.conversationId);

  useEffect(() => setShowSettings(Boolean(lesson.initialData || lesson.http)), [lesson.id, lesson.initialData, lesson.http]);

  // 新しい実行が始まったら、その送信メッセージが一番上に来るようにスクロール（返答が読めるように）
  const lastId = props.exchanges.at(-1)?.id;
  useEffect(() => {
    if (!lastId) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-exchange-id="${lastId}"]`);
    element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [lastId]);

  const visiblePast = props.pastHistory.filter((h) => h.conversationId === props.conversationId);
  const otherPast = props.pastHistory.length - visiblePast.length;
  const visibleLive = props.exchanges.filter((e) => e.conversationId === props.conversationId);

  const newConversation = () => {
    const base = lesson.conversationId.replace(/-\d+$/, '').replace(/-[a-z0-9]{4}$/, '');
    props.onConversationChange(`${base}-${randomId().slice(0, 4)}`);
  };

  const submit = () => {
    if (!conversationOk) return;
    props.onRun(props.draft);
  };

  return (
    <section className="pane run-pane" aria-label="実行">
      <div className="run-controls">
        <label className="field conversation-field">
          <span>会話ID</span>
          <input
            value={props.conversationId}
            onChange={(e) => props.onConversationChange(e.target.value.trim())}
            spellCheck={false}
            aria-invalid={!conversationOk}
          />
        </label>
        <button type="button" className="ghost" onClick={newConversation} title="新しい会話IDに切り替える（履歴の無い会話になる）">
          ＋ 新しい会話
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          title="初期データやマウント先の設定"
        >
          ⚙ 詳細
        </button>
        <button
          type="button"
          className="ghost danger"
          onClick={() => window.confirm('このレッスンで保存された会話をすべて削除しますか？') && props.onClear()}
          title="このレッスンの会話データ（サーバー側の保存も含む）を削除"
        >
          🗑
        </button>
      </div>
      {!conversationOk && <p className="field-error">会話ID には英数字と - _ . : だけが使えます。</p>}
      {showSettings && (
        <div className="run-settings">
          <label className="field">
            <span>初期データ (JSON)</span>
            <input
              value={props.initialData}
              onChange={(e) => props.onInitialDataChange(e.target.value)}
              placeholder='例: {"customerId": "C-42"}（会話を新しく作るときだけ使われます）'
              spellCheck={false}
            />
          </label>
          {lesson.http && (
            <label className="field">
              <span>マウント先</span>
              <input
                value={props.mountPath}
                onChange={(e) => props.onMountPathChange(e.target.value.trim())}
                placeholder={lesson.http}
                spellCheck={false}
              />
            </label>
          )}
        </div>
      )}

      <div className="exchange-list" ref={listRef} aria-live="polite">
        {visiblePast.length === 0 && visibleLive.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">まだ実行していません</p>
            <p>
              下のサンプルを押すか、メッセージを書いて <strong>▶ 実行</strong> してみましょう。
            </p>
            <p className="muted">
              会話ID「{props.conversationId}」の会話として送られます。同じ ID で送ると続きの会話になります。
            </p>
            {otherPast > 0 && <p className="muted">（ほかの会話IDでのやりとりが {otherPast} 件あります）</p>}
          </div>
        )}
        {visiblePast.length > 0 && <p className="divider">前回までのやりとり（詳細はこのセッションで実行したものだけ表示されます）</p>}
        {visiblePast.map((summary) => (
          <PastExchangeView key={summary.id} summary={summary} />
        ))}
        {visibleLive.map((exchange, index) => (
          <ExchangeView key={exchange.id} exchange={exchange} defaultOpen={index === visibleLive.length - 1} />
        ))}
      </div>

      <div className="composer">
        {lesson.messages.length > 0 && (
          <div className="samples" aria-label="サンプルメッセージ">
            <span className="samples-label">試す:</span>
            {lesson.messages.map((message) => (
              <button
                key={message}
                type="button"
                className="sample"
                onClick={() => props.onDraftChange(message)}
                onDoubleClick={() => props.onRun(message)}
                title="クリックで入力欄に入れる（ダブルクリックですぐ実行）"
                disabled={props.running}
              >
                {message.length > 40 ? `${message.slice(0, 40)}…` : message}
              </button>
            ))}
          </div>
        )}
        <div className="composer-row">
          <textarea
            value={props.draft}
            onChange={(e) => props.onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`エージェントへのメッセージ（Ctrl+Enter で実行）\n例: ${lesson.messages[0] ?? 'こんにちは'}`}
            rows={3}
            aria-label="エージェントへのメッセージ"
          />
          {props.running ? (
            <button type="button" className="run-button stop" onClick={props.onStop}>
              ■ 停止
            </button>
          ) : (
            <button
              type="button"
              className="run-button"
              onClick={submit}
              disabled={!props.draft.trim() || !conversationOk}
              title={props.mode === 'mock' ? 'モックLLMで実行' : '本物のLLMで実行'}
            >
              ▶ 実行
              <small>{props.mode === 'mock' ? 'モック' : '本物のLLM'}</small>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
