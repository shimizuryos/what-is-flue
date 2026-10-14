'use agent';
import { useModel, useSubagent, useTool } from '@flue/runtime';
import * as v from 'valibot';

// サブエージェントの中身も「ただのエージェント関数」。
// export しないこと（export すると独立したエージェントとして登録されてしまう）。
function Summarizer() {
  return 'あなたは要約の専門家です。渡された文章を 3 行以内で要約してください。';
}

function Translator() {
  // サブエージェントも自分専用のツールを持てる
  useTool({
    name: 'glossary',
    description: '用語集から、専門用語の決まった英訳を調べる。',
    input: v.object({ term: v.string() }),
    async run({ data }) {
      const dictionary: Record<string, string> = { エージェント: 'agent', 会話: 'conversation' };
      return dictionary[data.term] ?? '(用語集に無し)';
    },
  });
  return 'あなたは翻訳者です。日本語を自然な英語に翻訳してください。';
}

export function Editor() {
  useModel('anthropic/claude-haiku-4-5');

  // useSubagent で「仕事を任せられる相手」を登録する
  useSubagent({
    name: 'summarizer',
    description: '長い文章を 3 行に要約する。',
    agent: Summarizer,
  });
  useSubagent({
    name: 'translator',
    description: '日本語の文章を英語に翻訳する。',
    agent: Translator,
    // サブエージェントだけ別のモデルを使うこともできる（省略すると親と同じ）
    model: 'anthropic/claude-haiku-4-5',
  });

  return `あなたは編集長です。要約は summarizer、翻訳は translator に task ツールで任せてください。
任せるときは、相手が会話の流れを知らなくても分かるよう、必要な文章をすべて prompt に含めてください。`;
}
