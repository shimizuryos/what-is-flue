'use agent';
import { useModel, usePersistentState, useSkill, useSubagent, useTool } from '@flue/runtime';
import * as v from 'valibot';
import packingList from '../skills/packing-list/SKILL.md';

// ここは自由に書き換えて遊ぶためのプレイグラウンドです。
// これまでのレッスンの要素（ツール・状態・スキル・サブエージェント）を全部まぜた「旅行プランナー」です。

const WEATHER: Record<string, string> = { 札幌: '雪 -2℃', 東京: '晴れ 18℃', 那覇: 'くもり 25℃' };

function BudgetAdvisor() {
  return 'あなたは旅費の節約アドバイザーです。予算内に収めるコツを 3 つ挙げてください。';
}

export function TravelPlanner() {
  useModel('anthropic/claude-haiku-4-5');
  const [destination, setDestination] = usePersistentState<string | null>('destination', null);

  useTool({
    name: 'set_destination',
    description: '旅行の行き先を決めて保存する。',
    input: v.object({ city: v.picklist(['札幌', '東京', '那覇']) }),
    async run({ data }) {
      setDestination(data.city);
      return `行き先を ${data.city} にしました。weather ツールが使えます。`;
    },
  });

  // 行き先が決まったら天気ツールを解放
  if (destination) {
    useTool({
      name: 'weather',
      description: '行き先の天気を調べる。',
      async run() {
        return WEATHER[destination] ?? '不明';
      },
    });
  }

  useSkill(packingList);
  useSubagent({ name: 'budget-advisor', description: '旅費を節約する方法を提案する。', agent: BudgetAdvisor });

  return `あなたは旅行プランナーです。行き先: ${destination ?? '未定'}`;
}
