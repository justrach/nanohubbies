import { highlightLines, languageOf } from "@/pr/syntax";

/** Past this many lines a file is shown plain: highlighting and anchoring
 *  every line of a huge file costs more than it helps. */
const MAX_HIGHLIGHTED = 5000;

/** A file's lines, numbered and highlighted on the server. Each line is an
 *  anchor: #L12 links to line 12, and the page lights it. */
export function Highlighted({ text, path }: { text: string; path: string }) {
  const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  if (lines.length > MAX_HIGHLIGHTED) {
    return <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-5 whitespace-pre text-ink">{text}</pre>;
  }
  const pieces = highlightLines(lines.join("\n"), languageOf(path));
  return (
    <div className="file syn py-2">
      {lines.map((_, i) => (
        <div key={i} id={`L${i + 1}`} className="line">
          <a href={`#L${i + 1}`} className="ln" aria-label={`Line ${i + 1}`}>
            {i + 1}
          </a>
          <span className="code">
            {pieces[i]?.length
              ? pieces[i].map((p, j) =>
                  p.cls ? (
                    <span key={j} className={p.cls}>
                      {p.text}
                    </span>
                  ) : (
                    p.text
                  ),
                )
              : " "}
          </span>
        </div>
      ))}
    </div>
  );
}
