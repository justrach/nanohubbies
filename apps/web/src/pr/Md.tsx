import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { fenceLanguage, highlightLines } from "./syntax";

/** GitHub-flavoured markdown with the HTML GitHub allows (its own sanitizing
 *  rules) and nothing more. Fenced code is highlighted, in `lang` when the
 *  fence names none; a ```suggestion block is handed to `suggestion`.
 *  `link` and `image` map relative URLs, as a README in a repository means
 *  them; outside links open in a new tab. Renders on the server too. */
export function Md(props: {
  text: string;
  suggestion?: (code: string) => ReactNode;
  className?: string;
  lang?: string | null;
  link?: (href: string) => string;
  image?: (src: string) => string;
}) {
  const { text, suggestion, className, lang: fallback = null } = props;
  const relative = (url: string | undefined) => !!url && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code: ({ className: cls, children }) => {
      const code = String(children ?? "");
      const lang = /language-([\w+-]+)/.exec(cls ?? "")?.[1] ?? null;
      if (lang === null && !code.includes("\n")) return <code>{children}</code>;
      const body = code.replace(/\n$/, "");
      if (lang === "suggestion" && suggestion) return suggestion(body);
      return <Code code={body} lang={lang ? fenceLanguage(lang) : fallback} />;
    },
    a: ({ href, children }) =>
      relative(href) && props.link ? (
        <a href={props.link(href!)}>{children}</a>
      ) : (
        <a href={href} target={href?.startsWith("#") ? undefined : "_blank"} rel="noreferrer">
          {children}
        </a>
      ),
    img: ({ src, alt }) => {
      const url = typeof src === "string" ? src : undefined;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={relative(url) && props.image ? props.image(url!) : url} alt={alt ?? ""} loading="lazy" />;
    },
  };
  return (
    <div className={cn("md", className)}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>
        {text.replace(/<!--[\s\S]*?-->/g, "")}
      </Markdown>
    </div>
  );
}

function Code({ code, lang }: { code: string; lang: string | null }) {
  const lines = highlightLines(code, lang);
  return (
    <pre className="syn">
      <code>
        {lines.map((pieces, i) => (
          <div key={i}>
            {pieces.length ? pieces.map((p, j) => (p.cls ? <span key={j} className={p.cls}>{p.text}</span> : p.text)) : "​"}
          </div>
        ))}
      </code>
    </pre>
  );
}
