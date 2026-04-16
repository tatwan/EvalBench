import { Fragment, ReactNode } from "react";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      parts.push(
        <a
          key={`${match.index}-link`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      parts.push(
        <code key={`${match.index}-code`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      parts.push(<strong key={`${match.index}-bold`}>{match[5]}</strong>);
    } else if (match[6]) {
      parts.push(<em key={`${match.index}-italic`}>{match[6]}</em>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={`code-${i}`} className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-slate-100">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      const text = trimmed.replace(/^#{1,3}\s*/, "");
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push(
        <Tag key={`heading-${i}`} className="font-semibold text-foreground">
          {renderInline(text)}
        </Tag>
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      blocks.push(
        <blockquote key={`quote-${i}`} className="border-l-2 border-border pl-4 italic text-muted-foreground">
          {renderInline(trimmed.replace(/^>\s?/, ""))}
        </blockquote>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`ul-${i}-${idx}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`ol-${i}-${idx}`}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>\s?|[-*]\s+|\d+\.\s+)/.test(lines[i].trim())) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`} className="leading-relaxed">
        {paragraphLines.map((paragraphLine, idx) => (
          <Fragment key={`line-${i}-${idx}`}>
            {idx > 0 ? <br /> : null}
            {renderInline(paragraphLine)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className={className}>{blocks}</div>;
}
