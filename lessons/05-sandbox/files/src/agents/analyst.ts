'use agent';
import { bash, useModel, useSandbox } from '@flue/runtime';
import { Bash, InMemoryFs } from 'just-bash';

const SALES_CSV = `date,product,amount
2026-10-01,コーヒー豆,1200
2026-10-01,マグカップ,1800
2026-10-02,コーヒー豆,2400
2026-10-03,ドリッパー,3500
2026-10-03,コーヒー豆,1200
`;

export function DataAnalyst() {
  useModel('anthropic/claude-haiku-4-5');

  // サンドボックス = エージェントが作業する「ファイルシステム + シェル」。
  // ここでは just-bash による仮想サンドボックス（メモリ上のファイルと、TypeScript で再現した bash）を使います。
  // ホストのファイルやプロセスには一切触れられないので安全です。
  useSandbox(
    bash(
      () =>
        new Bash({
          // 最初から置いておくファイル
          fs: new InMemoryFs({
            '/data/sales.csv': SALES_CSV,
            '/data/README.md': '# 売上データ\n\nsales.csv に日別の売上があります。',
          }),
          cwd: '/data',
        }),
    ),
  );

  return 'あなたはデータ分析担当です。/data にある CSV を bash（awk, sort, grep など）で集計して答えてください。';
}
