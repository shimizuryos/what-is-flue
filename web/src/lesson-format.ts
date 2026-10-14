// lessons/<id>/lesson.md の frontmatter（YAML の小さなサブセット）を読むパーサー。
// フロントエンドとテストスクリプトの両方から使います。

export interface LessonMeta {
  title: string;
  summary: string;
  entry: string;
  conversationId: string;
  messages: string[];
  agentName?: string;
  initialData?: string;
  /** HTTP モードのときのマウント先（例: /agents/assistant） */
  http?: string;
}

export interface Lesson extends LessonMeta {
  id: string;
  body: string;
  files: Record<string, string>;
}

export function parseLessonMarkdown(source: string): { meta: LessonMeta; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) throw new Error('lesson.md に frontmatter がありません');
  const data: Record<string, string | string[]> = {};
  let currentList: string[] | undefined;
  for (const raw of match[1]!.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && currentList) {
      currentList.push(unquote(item[1]!));
      continue;
    }
    const pair = /^([\w-]+):\s*(.*)$/.exec(raw);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === '') {
      currentList = [];
      data[key!] = currentList;
    } else {
      currentList = undefined;
      data[key!] = unquote(value!);
    }
  }
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined);
  const meta: LessonMeta = {
    title: str('title') ?? '(無題)',
    summary: str('summary') ?? '',
    entry: str('entry') ?? 'src/agents/agent.ts',
    conversationId: str('conversationId') ?? 'conversation-1',
    messages: Array.isArray(data.messages) ? data.messages : [],
    agentName: str('agentName'),
    initialData: str('initialData'),
    http: str('http'),
  };
  return { meta, body: source.slice(match[0].length) };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}
