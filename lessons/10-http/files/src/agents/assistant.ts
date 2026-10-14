'use agent';
import { type AgentProps, useModel } from '@flue/runtime';

export function Assistant({ id }: AgentProps) {
  useModel('anthropic/claude-haiku-4-5');
  return `あなたは Web アプリに組み込まれたアシスタントです（会話ID: ${id}）。`;
}
