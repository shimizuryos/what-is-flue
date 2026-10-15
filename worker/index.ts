// 公開版（Cloudflare Workers）の /api/* を処理する Worker。
//
// 学習者のコードを実行するには Node.js（子プロセス・Vite・SQLite）が必要で、Workers では動かせません。
// そこで公開版の API は「ここは公開版です」と UI に伝えるだけにし、実行は手元の `npm run dev` に任せます。
// UI はこれを見て、サンプルメッセージについては事前に記録した実行結果（recordings/）を再生します。
import pkg from '../package.json' with { type: 'json' };

const REPOSITORY_URL = 'https://github.com/shimizuryos/what-is-flue';

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/status' && request.method === 'GET') {
      return Response.json({
        hosted: true,
        realModeAvailable: false,
        providersWithKeys: [],
        nodeVersion: null,
        flueVersion: pkg.dependencies['@flue/runtime'],
        repositoryUrl: REPOSITORY_URL,
      });
    }

    if (pathname === '/api/run' || pathname === '/api/reset') {
      return Response.json(
        {
          error: `公開版ではコードを実行できません。手元で起動してください: ${REPOSITORY_URL}#動かし方`,
        },
        { status: 501 },
      );
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
