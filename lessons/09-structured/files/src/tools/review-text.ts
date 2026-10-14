import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

// モデルに「この形で答えて」と強制したいデータの形
const Review = v.object({
  sentiment: v.picklist(['positive', 'neutral', 'negative']),
  score: v.pipe(v.number(), v.minValue(0), v.maxValue(10)),
  summary: v.string(),
});

// harness: true のツールは、エージェント自身の「ハーネス」（モデルやサンドボックス）にアクセスできる
export const reviewText = defineTool({
  name: 'review_text',
  description: 'レビュー文を分析し、感情・点数・要約を構造化データで返す。',
  input: v.object({ text: v.string() }),
  harness: true,

  async run({ harness, data, log }) {
    // サンドボックスにファイルを置く（会話には記録されない）
    await harness.sandbox.writeFile('review.txt', data.text);
    log.info('review.txt を書き込みました。モデルに分析させます…');

    // ツールの中で、別の小さな会話としてモデルを呼ぶ。
    // result にスキーマを渡すと、モデルは finish ツールでその形のデータを返すまで終われない
    const { data: review } = await harness.prompt('review.txt を読み、レビューを分析してください。', {
      result: Review,
    });

    return { output: review };
  },
});
