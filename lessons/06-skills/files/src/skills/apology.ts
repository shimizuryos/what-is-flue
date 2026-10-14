import { defineSkill } from '@flue/runtime';

// 短いスキルはコードの中で defineSkill() で定義することもできます。
export const apologyEmail = defineSkill({
  name: 'apology-email',
  description: 'お客様へのお詫びメールを書く。トラブルや遅延の謝罪文を頼まれたときに使う。',
  instructions: `お詫びメールは次の構成で書いてください。
1. 件名（【お詫び】で始める）
2. 謝罪の言葉
3. 何が起きたかの簡潔な説明
4. 今後の対応
5. 結びの挨拶`,
});
