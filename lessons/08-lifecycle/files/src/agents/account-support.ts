'use agent';
import {
  type AgentProps,
  useAgentStart,
  useInitialData,
  useModel,
  usePersistentState,
  useResponseFinish,
  useResponseStart,
} from '@flue/runtime';
import * as v from 'valibot';
import { crm, type Customer } from '../shared/crm.ts';

export function AccountSupport({ id }: AgentProps) {
  useModel('anthropic/claude-haiku-4-5');

  // 会話を「作るとき」に渡されたデータ（initialData）を読む。会話の一生を通じて変わらない
  const initial = useInitialData<{ customerId: string }>();
  const [customer, setCustomer] = usePersistentState<Customer | null>('customer', null);

  // メッセージが届くたび、モデルが動く前に実行される（async OK）。
  // データの読み込みにぴったりの場所。
  useAgentStart(async ({ log, append }) => {
    if (customer) return; // 1 会話につき 1 回だけ読み込む
    log.info(`顧客 ${initial.customerId} を CRM から読み込みます`);
    const loaded = await crm.lookup(initial.customerId);
    // ① 状態に保存 → 次のレンダーから指示文に反映される
    setCustomer(loaded);
    // ② この返答のモデルにもすぐ伝えたいので、シグナルとして会話に追加する
    append({
      kind: 'signal',
      type: 'crm.customer-loaded',
      body: loaded ? `顧客情報: ${loaded.name}（${loaded.plan} プラン）` : '顧客が見つかりませんでした',
    });
  });

  // 返答の開始・終了時に呼ばれ、戻り値が返答の「メタデータ」になる（モデルには見えない）
  useResponseStart(() => ({ startedAt: Date.now() }));
  useResponseFinish(({ metadata, response }) => ({
    elapsedMs: Date.now() - (metadata.startedAt as number),
    totalTokens: response.usage.totalTokens,
    toolCalls: response.toolCalls.length,
  }));

  console.log(`[render] 会話=${id} 顧客=${customer?.name ?? '(未読み込み)'}`);

  return customer
    ? `${customer.name} 様（${customer.plan} プラン）のアカウントに関する質問に答えてください。`
    : 'お客様のアカウントに関する質問に答えてください。';
}

// 会話作成時のデータをスキーマで検証する（不正なら会話の作成が失敗する）
AccountSupport.initialData = v.object({ customerId: v.string() });
