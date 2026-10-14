import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';
import { usePrefersDark } from '../hooks.ts';

export function EditorPane(props: {
  files: Record<string, string>;
  originalFiles: Record<string, string>;
  entry: string;
  activeFile: string;
  modified: Set<string>;
  onSelect: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onAddFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onReset: () => void;
  onRun: () => void;
}) {
  const dark = usePrefersDark();
  const runRef = useRef(props.onRun);
  runRef.current = props.onRun;

  const paths = useMemo(() => sortPaths(Object.keys(props.files), props.entry), [props.files, props.entry]);
  const active = props.activeFile;
  const isMarkdown = active.endsWith('.md');

  const extensions = useMemo(
    () => [
      isMarkdown ? markdown() : javascript({ typescript: true }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [isMarkdown],
  );

  const addFile = () => {
    const path = window.prompt('追加するファイルのパス（例: src/tools/my-tool.ts）', 'src/tools/my-tool.ts');
    if (!path) return;
    const cleaned = path.trim().replace(/^\.?\//, '');
    if (!/^[\w.@/-]+$/.test(cleaned) || cleaned.split('/').some((part) => part === '' || part === '..')) {
      window.alert('パスには英数字と . _ - / だけが使えます。');
      return;
    }
    props.onAddFile(cleaned);
  };

  const reset = () => {
    if (window.confirm('このレッスンのコードを最初の状態に戻します。よろしいですか？')) props.onReset();
  };

  const isUserFile = !(active in props.originalFiles);

  return (
    <section className="pane editor-pane" aria-label="コードエディタ">
      <div className="pane-toolbar">
        <div className="file-tabs" role="tablist" aria-label="ファイル">
          {paths.map((path) => (
            <button
              key={path}
              type="button"
              role="tab"
              aria-selected={path === active}
              className={`file-tab${path === active ? ' active' : ''}`}
              onClick={() => props.onSelect(path)}
              title={path}
            >
              {path === props.entry && <span className="entry-dot" title="実行されるエージェント（エントリ）">▶</span>}
              {fileLabel(path)}
              {props.modified.has(path) && <span className="modified-dot" aria-label="変更あり">●</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="ghost" onClick={addFile} title="ファイルを追加">
            ＋ ファイル
          </button>
          <button type="button" className="ghost" onClick={reset} title="コードを最初の状態に戻す">
            ↺ リセット
          </button>
        </div>
      </div>
      <div className="file-path">
        <code>{active}</code>
        {isUserFile && (
          <button
            type="button"
            className="link-button"
            onClick={() => window.confirm(`${active} を削除しますか？`) && props.onDeleteFile(active)}
          >
            削除
          </button>
        )}
      </div>
      <div className="editor-host">
        <CodeMirror
          key={active}
          value={props.files[active] ?? ''}
          height="100%"
          theme={dark ? oneDark : 'light'}
          extensions={extensions}
          onChange={(value) => props.onChange(active, value)}
          basicSetup={{ tabSize: 2, foldGutter: false }}
          aria-label={`${active} の編集`}
        />
      </div>
    </section>
  );
}

function fileLabel(path: string): string {
  const parts = path.split('/');
  const name = parts.at(-1)!;
  // SKILL.md のように同名ファイルが多いものはディレクトリ名も出す
  return name === 'SKILL.md' || name === 'EXAMPLES.md' ? parts.slice(-2).join('/') : name;
}

function sortPaths(paths: string[], entry: string): string[] {
  const rank = (path: string) => (path === entry ? 0 : path.includes('/agents/') ? 1 : path.endsWith('app.ts') ? 0.5 : 2);
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
