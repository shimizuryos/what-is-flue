'use agent';
import { useModel, useSkill } from '@flue/runtime';
// SKILL.md を import すると、ディレクトリごと（EXAMPLES.md も含めて）スキルとして取り込まれます
import haiku from '../skills/haiku/SKILL.md';
import { apologyEmail } from '../skills/apology.ts';

export function Writer() {
  useModel('anthropic/claude-haiku-4-5');

  // スキルを取り付ける。最初は「名前と説明」だけがシステムプロンプトに載り、
  // モデルが必要だと判断したときに activate_skill で本文を読み込みます。
  useSkill(haiku);
  useSkill(apologyEmail);

  return 'あなたは文章を書くアシスタントです。依頼に合うスキルがあれば、まずそのスキルを読み込んでから書いてください。';
}
