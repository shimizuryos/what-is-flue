'use agent';
import { useModel, useTool } from '@flue/runtime';
import { lookupOrder } from '../tools/lookup-order.ts';

export function OrderAssistant() {
  useModel('anthropic/claude-haiku-4-5');

  // useTool() でツールをエージェントに取り付ける
  useTool(lookupOrder);

  // その場で書くこともできる（defineTool と同じ形のオブジェクト）
  useTool({
    name: 'current_time',
    description: '現在の日時を返す。',
    async run() {
      return new Date().toISOString();
    },
  });

  return '注文に関する質問に答えるアシスタントです。注文の状況は必ず lookup_order で確認してください。';
}
