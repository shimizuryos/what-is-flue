'use agent';
import { useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';

export function SupportAgent() {
  useModel('anthropic/claude-haiku-4-5');

  // usePersistentState は React の useState に似ていますが、値は会話ごとに「永続化」されます。
  // 次のメッセージでも、サーバーを再起動しても、同じ会話IDなら値が残ります。
  const [escalated, setEscalated] = usePersistentState('escalated', false);
  const [inquiries, setInquiries] = usePersistentState('inquiries', 0);

  console.log(`[render] escalated=${escalated} inquiries=${inquiries}`);

  useTool({
    name: 'record_inquiry',
    description: '問い合わせを 1 件記録する。',
    async run() {
      // 前の値から計算するときは「更新関数」を渡す（最新の値が previous に入る）
      setInquiries((previous) => previous + 1);
      return '記録しました。';
    },
  });

  useTool({
    name: 'escalate',
    description: '返金が必要な場合に、この会話を上位担当へエスカレーションする。',
    async run() {
      setEscalated(true);
      return 'エスカレーションしました。refund ツールが使えるようになります。';
    },
  });

  // 状態によってツールを出し分ける（条件付きツール）。
  // エスカレーションされるまで refund ツールは「存在しない」ので、モデルは絶対に呼べません。
  if (escalated) {
    useTool({
      name: 'refund',
      description: '指定した金額（円）を返金する。',
      input: v.object({ amount: v.number() }),
      async run({ data }) {
        return `${data.amount} 円を返金しました。`;
      },
    });
  }

  // 状態を指示（システムプロンプト）に埋め込むこともできる
  return `カスタマーサポート担当です。
現在の状態: エスカレーション=${escalated ? '済み' : 'まだ'} / 記録した問い合わせ=${inquiries}件`;
}
