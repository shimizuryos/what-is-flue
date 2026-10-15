import { useEffect } from 'react';
import type { ServerStatus } from '../api.ts';

export function HelpDialog(props: { status: ServerStatus | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <div className="dialog-backdrop" onClick={props.onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2 id="help-title">Flue Playground へようこそ</h2>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="dialog-body markdown">
          <p>
            <strong>Flue</strong>（AI エージェントのフレームワーク）を、コードを書き換えて実行しながら学ぶためのアプリです。
          </p>
          <ol>
            <li>
              <strong>📖 レッスン</strong>（左）で説明を読む
            </li>
            <li>
              <strong>✏️ コード</strong>（中央）でエージェントのコードを見る・書き換える
            </li>
            <li>
              <strong>▶ 実行</strong>（右）でメッセージを送り、何が起きたかを見る
            </li>
          </ol>
          <p>
            実行すると、サーバーが <strong>本物の Flue ランタイム</strong>（<code>@flue/runtime</code>）であなたのコードを動かします。
            タイムラインでは、モデルの呼び出し・ツールの実行・サブエージェントへの委任が順番に表示され、
            <strong>🔍 モデルへの入力</strong> を押すと LLM に実際に送られたシステムプロンプト・ツール一覧・会話履歴を確認できます。
          </p>

          {props.status?.hosted && (
            <>
              <h3>🌐 公開版について</h3>
              <p>
                このページは Cloudflare Workers で公開している閲覧用の版です。コードの実行には Node.js のサーバーが必要なため、ここでは
                <strong>「試す:」のサンプルメッセージを、元のコードのまま送ったときだけ</strong>、モックLLMで実行した記録を再生します。
                コードを書き換えて実行するには、
                <a href={`${props.status.repositoryUrl ?? ''}#動かし方`} target="_blank" rel="noreferrer">
                  リポジトリ
                </a>
                を手元に clone して <code>npm install</code> → <code>npm run dev</code> で起動してください。
              </p>
            </>
          )}

          <h3>🤖 モックLLM（APIキー不要）</h3>
          <p>本物の LLM の代わりに、次のルールで応答する偽物のモデルです。文章は賢くありませんが、Flue 側の動きはすべて本物です。</p>
          <ul>
            <li>
              メッセージに <strong>ツール名</strong>（例: <code>lookup_order</code>）があれば、そのツールを呼ぶ
            </li>
            <li>
              <code>$ ls -la</code> のように <code>$</code> で始まる行は <code>bash</code> ツールで実行する
            </li>
            <li>
              <strong>スキル名・サブエージェント名</strong> があれば <code>activate_skill</code>・<code>task</code> を呼ぶ
            </li>
            <li>
              <code>/call ツール名 {'{"引数": "値"}'}</code> で任意のツールを引数付きで呼べる
            </li>
            <li>構造化出力が必要なとき（<code>finish</code> ツール）は、スキーマに合う値を返す</li>
            <li>それ以外は「受け取った指示・ツール・履歴」を説明する文章で返事をする</li>
          </ul>

          <h3>✨ 本物のLLM</h3>
          <p>
            プロジェクト直下に <code>.env</code> を作り <code>ANTHROPIC_API_KEY="..."</code> を書いてサーバーを再起動すると、
            ヘッダーの「本物のLLM」が選べるようになります。レッスンのコードは <code>anthropic/claude-haiku-4-5</code> を使っています。
            ほかのプロバイダーを使う場合は <code>useModel()</code> の文字列とキーを変えてください。
          </p>
          <p className="muted">
            {props.status
              ? props.status.hosted
                ? '公開版では本物のLLMは使えません。'
                : props.status.realModeAvailable
                ? `現在 API キーが設定されているプロバイダー: ${props.status.providersWithKeys.join(', ')}`
                : '現在 API キーは設定されていません（モックLLMで動作します）。'
              : 'サーバーの状態を確認中…'}
          </p>

          <h3>⌨️ ショートカット</h3>
          <ul>
            <li>
              <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd>：実行
            </li>
          </ul>
        </div>
        <footer className="dialog-footer">
          <button type="button" className="primary" onClick={props.onClose}>
            はじめる
          </button>
        </footer>
      </div>
    </div>
  );
}
