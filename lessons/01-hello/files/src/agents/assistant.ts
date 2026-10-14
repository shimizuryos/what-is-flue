// 'use agent' ディレクティブ：このファイルが「エージェントを定義するモジュール」だと Flue に伝える目印。
// （'use strict' や React の 'use client' と同じく、ファイルの先頭に書く）
'use agent';
import { useModel } from '@flue/runtime';

// Flue では「エージェント = 関数」です。
// export された大文字始まりの関数がエージェントとして登録されます。
export function Assistant() {
  // useModel() で使う LLM を宣言します（唯一の必須フック）。
  // 書式は 'プロバイダーID/モデルID'。APIキーはコードではなく環境変数（.env）から読まれます。
  useModel('anthropic/claude-haiku-4-5');

  // 戻り値の文字列がエージェントへの「指示」＝システムプロンプトになります。
  return 'あなたは親切なアシスタントです。返答は短く、日本語でしてください。';
}
