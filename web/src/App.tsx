import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunMode } from '../../server/protocol.ts';
import { fetchStatus, resetWorkspace, runAgent, type ServerStatus } from './api.ts';
import { EditorPane } from './components/EditorPane.tsx';
import { HelpDialog } from './components/HelpDialog.tsx';
import { LessonPane } from './components/LessonPane.tsx';
import { RunPane } from './components/RunPane.tsx';
import { applyEvent, createExchange, type Exchange, type ExchangeSummary, summarize } from './exchange.ts';
import { lessons } from './lessons.ts';
import { load, randomId, remove, save } from './storage.ts';

type MobileTab = 'lesson' | 'code' | 'run';

export function App() {
  const [clientId] = useState(() => {
    const existing = load<string | null>('clientId', null);
    if (existing && /^[\w-]{1,64}$/.test(existing)) return existing;
    const created = randomId('c');
    save('clientId', created);
    return created;
  });
  const [lessonId, setLessonId] = useState(() => {
    const saved = load<string | null>('lesson', null);
    return lessons.some((l) => l.id === saved) ? saved! : lessons[0]!.id;
  });
  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0]!;
  const lessonIndex = lessons.indexOf(lesson);

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>(() => load<RunMode>('mode', 'mock'));
  const [showHelp, setShowHelp] = useState(() => !load('helpSeen', false));
  const [mobileTab, setMobileTab] = useState<MobileTab>('lesson');

  // レッスンごとの編集中ファイル・会話設定
  const [files, setFiles] = useState<Record<string, string>>(() => loadFiles(lesson.id));
  const [activeFile, setActiveFile] = useState(lesson.entry);
  const [conversationId, setConversationId] = useState(() => load(`conv:${lesson.id}`, lesson.conversationId));
  const [initialData, setInitialData] = useState(() => load(`init:${lesson.id}`, lesson.initialData ?? ''));
  const [mountPath, setMountPath] = useState(() => load(`mount:${lesson.id}`, lesson.http ?? ''));
  const [history, setHistory] = useState<ExchangeSummary[]>(() => load(`history:${lesson.id}`, []));
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const running = exchanges.some((e) => e.status === 'running');
  // 実行中にレッスン切り替えや履歴削除が起きても、終わった実行の記録が別のレッスンに混ざらないようにする
  const lessonIdRef = useRef(lesson.id);
  lessonIdRef.current = lesson.id;
  const historyEpochRef = useRef(0);

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        setStatus(s);
        if (!s.realModeAvailable) setMode('mock');
      })
      .catch(() => setStatusError('サーバーに接続できません。`npm run dev` で起動しているか確認してください。'));
  }, []);

  useEffect(() => save('mode', mode), [mode]);

  const switchLesson = useCallback(
    (id: string) => {
      if (id === lessonId) return;
      abortRef.current?.abort();
      const next = lessons.find((l) => l.id === id)!;
      save('lesson', id);
      setLessonId(id);
      setFiles(loadFiles(id));
      setActiveFile(next.entry);
      setConversationId(load(`conv:${id}`, next.conversationId));
      setInitialData(load(`init:${id}`, next.initialData ?? ''));
      setMountPath(load(`mount:${id}`, next.http ?? ''));
      setHistory(load(`history:${id}`, []));
      setExchanges([]);
      setDraft('');
      setMobileTab('lesson');
    },
    [lessonId],
  );

  const updateFile = useCallback(
    (path: string, content: string) => {
      setFiles((previous) => {
        const next = { ...previous, [path]: content };
        save(`files:${lesson.id}`, next);
        return next;
      });
    },
    [lesson.id],
  );

  const addFile = useCallback(
    (path: string) => {
      setFiles((previous) => {
        if (path in previous) return previous;
        const next = { ...previous, [path]: '' };
        save(`files:${lesson.id}`, next);
        return next;
      });
      setActiveFile(path);
    },
    [lesson.id],
  );

  const deleteFile = useCallback(
    (path: string) => {
      setFiles((previous) => {
        const next = { ...previous };
        delete next[path];
        save(`files:${lesson.id}`, next);
        return next;
      });
      setActiveFile(lesson.entry);
    },
    [lesson.id, lesson.entry],
  );

  const resetFiles = useCallback(() => {
    remove(`files:${lesson.id}`);
    setFiles({ ...lesson.files });
    setActiveFile(lesson.entry);
  }, [lesson]);

  const changeConversation = useCallback(
    (id: string) => {
      setConversationId(id);
      save(`conv:${lesson.id}`, id);
    },
    [lesson.id],
  );

  const clearConversations = useCallback(async () => {
    historyEpochRef.current++;
    abortRef.current?.abort();
    await resetWorkspace(clientId, lesson.id);
    remove(`history:${lesson.id}`);
    setHistory([]);
    setExchanges([]);
  }, [clientId, lesson.id]);

  const run = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || running) return;
      setMobileTab('run');
      const controller = new AbortController();
      abortRef.current = controller;
      const runLessonId = lesson.id;
      const runEpoch = historyEpochRef.current;
      const exchange = createExchange(text, conversationId, mode);
      let current = exchange;
      setExchanges((previous) => [...previous, exchange]);
      setDraft('');

      const update = (next: Exchange) => {
        current = next;
        setExchanges((previous) => previous.map((e) => (e.id === next.id ? next : e)));
      };

      try {
        await runAgent(
          {
            clientId,
            lessonId: lesson.id,
            files,
            entry: lesson.entry,
            agentName: lesson.agentName,
            conversationId,
            message: text,
            initialData: initialData.trim() || undefined,
            mode,
            http: lesson.http ? { mountPath: mountPath || lesson.http } : undefined,
          },
          (event) => update(applyEvent(current, event)),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          update({ ...current, status: 'aborted', statusText: undefined });
        } else {
          update(
            applyEvent(applyEvent(current, { type: 'error', phase: 'server', message: String(error) }), {
              type: 'done',
              outcome: 'error',
              elapsedMs: Date.now() - current.startedAt,
            }),
          );
        }
      }
      if (current.status === 'running') update({ ...current, status: 'aborted', statusText: undefined });
      if (historyEpochRef.current !== runEpoch) return;
      const next = [...load<ExchangeSummary[]>(`history:${runLessonId}`, []), summarize(current)].slice(-30);
      save(`history:${runLessonId}`, next);
      if (lessonIdRef.current === runLessonId) setHistory(next);
    },
    [running, conversationId, mode, clientId, lesson, files, initialData, mountPath],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // リロード前の履歴のうち、今のセッションで実行したもの以外を「過去のやりとり」として表示
  const liveIds = useMemo(() => new Set(exchanges.map((e) => e.id)), [exchanges]);
  const pastHistory = history.filter((h) => !liveIds.has(h.id));

  const modified = useMemo(() => {
    const changed = new Set<string>();
    for (const [path, content] of Object.entries(files)) if (lesson.files[path] !== content) changed.add(path);
    return changed;
  }, [files, lesson.files]);

  return (
    <div className="app" data-tab={mobileTab}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span className="brand-name">Flue Playground</span>
          {status && <span className="brand-version">@flue/runtime {status.flueVersion}</span>}
        </div>
        <label className="lesson-picker">
          <span className="visually-hidden">レッスンを選ぶ</span>
          <select value={lesson.id} onChange={(e) => switchLesson(e.target.value)}>
            {lessons.map((l, index) => (
              <option key={l.id} value={l.id}>
                {index + 1}. {l.title}
              </option>
            ))}
          </select>
        </label>
        <div className="mode-switch" role="radiogroup" aria-label="実行モード">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'mock'}
            className={mode === 'mock' ? 'active' : ''}
            onClick={() => setMode('mock')}
            title="APIキー不要。決まったルールで応答する偽のLLMで、本物の Flue ランタイムを動かします"
          >
            🤖 モックLLM
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'real'}
            className={mode === 'real' ? 'active' : ''}
            disabled={!status?.realModeAvailable}
            onClick={() => setMode('real')}
            title={
              status?.realModeAvailable
                ? `APIキーが設定されたプロバイダー: ${status.providersWithKeys.join(', ')}`
                : 'APIキーが設定されていません（.env を作成してサーバーを再起動してください）'
            }
          >
            ✨ 本物のLLM
          </button>
        </div>
        <button type="button" className="help-button" onClick={() => setShowHelp(true)}>
          ？ 使い方
        </button>
      </header>

      {statusError && <div className="banner banner-error">{statusError}</div>}

      <nav className="mobile-tabs" aria-label="表示切り替え">
        {(
          [
            ['lesson', '📖 レッスン'],
            ['code', '✏️ コード'],
            ['run', '▶ 実行'],
          ] as const
        ).map(([tab, label]) => (
          <button key={tab} type="button" className={mobileTab === tab ? 'active' : ''} onClick={() => setMobileTab(tab)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="workspace">
        <LessonPane
          lesson={lesson}
          index={lessonIndex}
          total={lessons.length}
          onPrev={lessonIndex > 0 ? () => switchLesson(lessons[lessonIndex - 1]!.id) : undefined}
          onNext={lessonIndex < lessons.length - 1 ? () => switchLesson(lessons[lessonIndex + 1]!.id) : undefined}
        />
        <EditorPane
          files={files}
          originalFiles={lesson.files}
          entry={lesson.entry}
          activeFile={files[activeFile] !== undefined ? activeFile : lesson.entry}
          modified={modified}
          onSelect={setActiveFile}
          onChange={updateFile}
          onAddFile={addFile}
          onDeleteFile={deleteFile}
          onReset={resetFiles}
          onRun={() => run(draft || lesson.messages[0] || '')}
        />
        <RunPane
          lesson={lesson}
          mode={mode}
          conversationId={conversationId}
          onConversationChange={changeConversation}
          initialData={initialData}
          onInitialDataChange={(value) => {
            setInitialData(value);
            save(`init:${lesson.id}`, value);
          }}
          mountPath={mountPath}
          onMountPathChange={(value) => {
            setMountPath(value);
            save(`mount:${lesson.id}`, value);
          }}
          pastHistory={pastHistory}
          exchanges={exchanges}
          draft={draft}
          onDraftChange={setDraft}
          running={running}
          onRun={run}
          onStop={stop}
          onClear={clearConversations}
        />
      </main>

      {showHelp && (
        <HelpDialog
          status={status}
          onClose={() => {
            setShowHelp(false);
            save('helpSeen', true);
          }}
        />
      )}
    </div>
  );
}

function loadFiles(lessonId: string): Record<string, string> {
  const lesson = lessons.find((l) => l.id === lessonId)!;
  const saved = load<Record<string, string> | null>(`files:${lessonId}`, null);
  return saved && typeof saved === 'object' && lesson.entry in saved ? saved : { ...lesson.files };
}
