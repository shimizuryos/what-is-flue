import { marked } from 'marked';
import { useEffect, useMemo, useRef } from 'react';
import type { Lesson } from '../lesson-format.ts';

marked.use({ gfm: true });

export function LessonPane(props: {
  lesson: Lesson;
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { lesson } = props;
  const html = useMemo(() => {
    const rendered = marked.parse(lesson.body, { async: false });
    // 外部リンクは新しいタブで開く
    return rendered.replace(/<a href="(https?:)/g, '<a target="_blank" rel="noreferrer" href="$1');
  }, [lesson.body]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lesson.id]);

  return (
    <section className="pane lesson-pane" aria-label="レッスン">
      <div className="pane-scroll" ref={scrollRef}>
        <p className="lesson-step">
          レッスン {props.index + 1} / {props.total}
        </p>
        <h1 className="lesson-title">{lesson.title}</h1>
        <p className="lesson-summary">{lesson.summary}</p>
        <article className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
        <nav className="lesson-nav" aria-label="レッスン移動">
          <button type="button" onClick={props.onPrev} disabled={!props.onPrev}>
            ← 前のレッスン
          </button>
          <button type="button" className="primary" onClick={props.onNext} disabled={!props.onNext}>
            次のレッスン →
          </button>
        </nav>
      </div>
    </section>
  );
}
