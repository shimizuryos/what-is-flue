// /lessons 以下のレッスン（lesson.md と files/**）をビルド時に取り込む
import { type Lesson, parseLessonMarkdown } from './lesson-format.ts';

const markdown = import.meta.glob('../../lessons/*/lesson.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const files = import.meta.glob('../../lessons/*/files/**/*', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const lessons: Lesson[] = Object.entries(markdown)
  .map(([key, source]) => {
    const id = key.split('/').at(-2)!;
    const { meta, body } = parseLessonMarkdown(source);
    const prefix = `../../lessons/${id}/files/`;
    const lessonFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (path.startsWith(prefix)) lessonFiles[path.slice(prefix.length)] = content;
    }
    return { id, ...meta, body, files: lessonFiles };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
