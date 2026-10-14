'use agent';
import { bash, useDataWriter, useModel, useSandbox, useTool } from '@flue/runtime';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';
import { reviewText } from '../tools/review-text.ts';

export function ReviewAnalyst() {
  useModel('anthropic/claude-haiku-4-5');
  useSandbox(bash(() => new Bash({ fs: new InMemoryFs() })));
  useTool(reviewText);

  // クライアント（画面）に構造化データを流すための「データチャンネル」。
  // モデルには見えず、UI でカードや進捗バーを描くのに使う
  const writeProgress = useDataWriter('progress', {
    schema: v.object({ step: v.number(), total: v.number(), label: v.string() }),
  });

  useTool({
    name: 'batch_analyze',
    description: '複数のレビューをまとめて分析する（デモ用。進捗を画面に流す）。',
    input: v.object({ count: v.number() }),
    async run({ data }) {
      for (let step = 1; step <= data.count; step++) {
        writeProgress({ step, total: data.count, label: `${step} 件目を分析中` });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return `${data.count} 件の分析が完了しました。`;
    },
  });

  return 'あなたはレビュー分析担当です。レビューの分析には review_text ツールを使ってください。';
}
