'use agent';
import { type AgentProps, useModel } from '@flue/runtime';

// エージェント関数は props として { id } を受け取ります。
// id は「どの会話か」を表す文字列で、flue run の --id や HTTP の /agents/memo/:id に当たります。
export function Memo({ id }: AgentProps) {
  useModel('anthropic/claude-haiku-4-5');

  // エージェント関数は「モデルを呼ぶ直前」に毎回実行（再レンダー）されます。
  // ログ欄で、何回・いつ実行されたかを確認してみましょう。
  console.log(`[render] 会話 "${id}" のためにエージェント関数が実行されました`);

  return `あなたはメモ係です。この会話のIDは「${id}」です。
ユーザーが教えてくれたことを覚えておき、聞かれたら答えてください。`;
}
