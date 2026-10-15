import { Fragment, type ReactNode } from "react";
import type { Hunk, Row } from "./patch";
import { markPieces, type Piece } from "./syntax";

/** The rows of a diff, hunk by hunk. `pieces` holds every row's highlighted
 *  text, in order; `after` puts something (a review thread) under a row;
 *  `limit` stops after that many rows. */
export function Rows(props: { hunks: Hunk[]; pieces: Piece[][]; id?: string; limit?: number; after?: (row: Row) => ReactNode }) {
  let k = 0;
  let shown = 0;
  return (
    <>
      {props.hunks.map((h, hi) => {
        if (props.limit !== undefined && shown >= props.limit) {
          k += h.rows.length;
          return null;
        }
        return (
          <Fragment key={hi}>
            {(h.hidden > 0 || (h.section && hi > 0)) && (
              <div className="gap">
                {h.hidden > 0 ? `${h.hidden.toLocaleString("en-US")} unchanged line${h.hidden === 1 ? "" : "s"}` : ""}
                {h.section && <span className="ml-3 text-ink-2">{h.section}</span>}
              </div>
            )}
            {h.rows.map((r) => {
              const pieces = props.pieces[k++] ?? [{ text: r.text, cls: "" }];
              if (props.limit !== undefined && shown++ >= props.limit) return null;
              return (
                <Fragment key={k}>
                  <RowView row={r} pieces={pieces} id={props.id && r.new !== null ? `${props.id}-${r.new}` : undefined} />
                  {props.after?.(r)}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

function RowView({ row, pieces, id }: { row: Row; pieces: Piece[]; id?: string }) {
  const parts = markPieces(pieces, row.words);
  return (
    <div id={id} className={`row ${row.kind}`}>
      <span className="ln">{row.old ?? ""}</span>
      <span className="ln">{row.new ?? ""}</span>
      <span className="sign">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span>
      <span className="code">
        {parts.length
          ? parts.map((p, i) =>
              p.cls ? (
                <span key={i} className={p.cls}>
                  {p.text}
                </span>
              ) : (
                p.text
              ),
            )
          : " "}
      </span>
    </div>
  );
}
