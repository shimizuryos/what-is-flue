import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { orders } from '../shared/orders.ts';

// ツール = あなたが書いた関数を、モデルが「必要だと判断したとき」に呼べるようにしたもの。
export const lookupOrder = defineTool({
  // モデルはこの名前でツールを呼びます
  name: 'lookup_order',
  // モデルにとって唯一の説明書。「何をするか・いつ使うか・何を返すか」を書く
  description: '注文IDから注文の状況（商品名・ステータス・お届け予定日）を調べる。',
  // 引数のスキーマ（Valibot）。モデルの引数はこれで検証されてから run に渡される
  input: v.object({ orderId: v.string() }),

  async run({ data, log }) {
    log.info(`注文 ${data.orderId} を検索します`);
    const order = await orders.get(data.orderId);
    // throw したエラーはエージェントを止めず、「ツールのエラー」としてモデルに返されます
    if (!order) throw new Error(`注文 ${data.orderId} は見つかりませんでした`);
    // 戻り値は { output } の形。output は JSON にしてモデルに渡されます
    return { output: order };
  },
});
