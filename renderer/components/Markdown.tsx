// AiCursor standalone project file.
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { ipc } from '../lib/ipc';

// Allow common HTML primitives Gemini may emit for richer answers, but
// SANITISE everything: drop scripts, event handlers, foreign attrs.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'div',
    'section',
    'article',
    'aside',
    'figure',
    'figcaption',
    'span',
    'kbd',
    'mark',
    'small',
    'sup',
    'sub',
    'details',
    'summary',
    'svg',
    'path',
    'circle',
    'rect',
    'line',
    'polygon',
    'polyline',
    'g',
    'text',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...((defaultSchema.attributes && defaultSchema.attributes['*']) ?? []),
      'className',
      'class',
      // 'style' is intentionally NOT in this allowlist. Inline styles open up
      // background-image: url(...) data-exfil patterns even when CSP blocks
      // arbitrary connect-src, because img-src needs to allow data: for
      // legitimate inline images. Markdown doesn't need inline styles in this
      // app; layout is driven by component classNames above.
      'id',
      'role',
      'aria-label',
      'aria-hidden',
      'data-variant',
    ],
    svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'strokeWidth'],
    path: ['d', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth'],
    a: ['href', 'title', 'target', 'rel'],
  },
};

const components: Components = {
  h1: (p) => (
    <h1
      className="mt-2 mb-1 text-[15px] font-semibold leading-snug text-white dark:text-neutral-900"
      {...p}
    />
  ),
  h2: (p) => (
    <h2
      className="mt-2 mb-1 border-b border-white/8 pb-1 text-[14px] font-semibold leading-snug text-white dark:border-neutral-900/10 dark:text-neutral-900"
      {...p}
    />
  ),
  h3: (p) => (
    <h3
      className="mt-1.5 mb-0.5 text-[13.5px] font-semibold leading-snug text-white/90 dark:text-neutral-900/90"
      {...p}
    />
  ),
  p: (p) => (
    <p
      className="my-1 text-[13.5px] leading-[1.55] text-white/92 dark:text-neutral-900/92"
      {...p}
    />
  ),
  strong: (p) => (
    <strong className="font-semibold text-white dark:text-neutral-900" {...p} />
  ),
  em: (p) => <em className="italic" {...p} />,
  ul: (p) => (
    <ul
      className="my-1.5 ml-4 list-disc space-y-0.5 text-white/92 marker:text-accent dark:text-neutral-900/92"
      {...p}
    />
  ),
  ol: (p) => (
    <ol
      className="my-1.5 ml-5 list-decimal space-y-0.5 text-white/92 marker:text-accent dark:text-neutral-900/92"
      {...p}
    />
  ),
  li: (p) => <li className="text-[13.5px] leading-[1.55]" {...p} />,
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (!href) return;
        if (href.startsWith('session://')) {
          const path = decodeURIComponent(href.slice('session://'.length));
          void ipc.revealSession(path);
          return;
        }
        void ipc.openExternal(href);
      }}
      className="text-accent underline decoration-accent/40 decoration-[1.5px] underline-offset-2 hover:decoration-accent"
      {...rest}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = (className ?? '').includes('language-');
    if (isBlock) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-white/12 px-1 py-[1px] font-mono text-[12px] text-white/92 dark:bg-neutral-900/12 dark:text-neutral-900/92"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: (p) => (
    <pre
      className="my-1.5 overflow-x-auto rounded-md border border-white/8 bg-white/6 p-2 font-mono text-[12px] leading-snug text-white/92 dark:border-neutral-900/10 dark:bg-neutral-900/8 dark:text-neutral-900/92"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote
      className="my-1.5 rounded-r-md border-l-2 border-accent/60 bg-accent/8 py-1.5 pl-3 text-[13px] italic text-white/88 dark:text-neutral-900/85"
      {...p}
    />
  ),
  hr: () => <hr className="my-2 border-white/10 dark:border-neutral-900/10" />,
  table: (p) => (
    <div className="my-2 overflow-x-auto rounded-md border border-white/8 dark:border-neutral-900/10">
      <table
        className="w-full border-collapse text-[12.5px] text-white/92 dark:text-neutral-900/92"
        {...p}
      />
    </div>
  ),
  th: (p) => (
    <th
      className="border-b border-white/12 bg-white/5 px-2 py-1.5 text-left font-semibold text-white dark:border-neutral-900/12 dark:bg-neutral-900/5 dark:text-neutral-900"
      {...p}
    />
  ),
  td: (p) => (
    <td
      className="border-b border-white/8 px-2 py-1.5 last:border-b-0 dark:border-neutral-900/8"
      {...p}
    />
  ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="ai-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
