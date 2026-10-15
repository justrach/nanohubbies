/** Seeds for new trunks. "shop" is small enough to read in one sitting and has
 *  enough shared functions for a swarm to collide on. */
export const TEMPLATES: Record<string, Record<string, string>> = {
  shop: {
    "package.json": '{ "name": "shop", "type": "module" }\n',
    "README.md": "# shop\n\nA tiny shop library that agents work on together.\n",
    "src/format.js": lines(
      "/** Format a price in cents as dollars. */",
      "export function formatPrice(cents) {",
      "  return `$${(cents / 100).toFixed(2)}`;",
      "}",
      "",
      "/** Format a quantity with its unit, pluralised. */",
      "export function formatQty(n, unit) {",
      '  return `${n} ${unit}${n === 1 ? "" : "s"}`;',
      "}",
    ),
    "src/cart.js": lines(
      'import { formatPrice } from "./format.js";',
      "",
      "/** Total of a cart in cents. */",
      "export function total(items) {",
      "  return items.reduce((sum, it) => sum + it.cents * it.qty, 0);",
      "}",
      "",
      "/** One-line summary of a cart. */",
      "export function summary(items) {",
      "  return `${items.length} items, ${formatPrice(total(items))}`;",
      "}",
    ),
    "src/shared/strings.js": lines(
      "/** Upper-case the first letter. */",
      "export function capitalize(s) {",
      "  return s.charAt(0).toUpperCase() + s.slice(1);",
      "}",
      "",
      "/** A URL-safe slug. */",
      "export function slugify(s) {",
      '  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");',
      "}",
      "",
      "/** Shorten to n characters with an ellipsis. */",
      "export function truncate(s, n) {",
      '  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;',
      "}",
      "",
      "/** Pad on the left to width w. */",
      "export function padLeft(s, w, ch = \" \") {",
      "  return String(s).padStart(w, ch);",
      "}",
    ),
    "src/shared/numbers.js": lines(
      "/** Clamp x to [lo, hi]. */",
      "export function clamp(x, lo, hi) {",
      "  return Math.min(hi, Math.max(lo, x));",
      "}",
      "",
      "/** Round to n decimal places. */",
      "export function round(x, n = 0) {",
      "  const f = 10 ** n;",
      "  return Math.round(x * f) / f;",
      "}",
      "",
      "/** Sum of a list. */",
      "export function sum(xs) {",
      "  return xs.reduce((a, b) => a + b, 0);",
      "}",
      "",
      "/** Mean of a list, or 0 for an empty one. */",
      "export function mean(xs) {",
      "  return xs.length ? sum(xs) / xs.length : 0;",
      "}",
      "",
      "/** Percentage of part in whole. */",
      "export function percent(part, whole) {",
      "  return whole ? (100 * part) / whole : 0;",
      "}",
    ),
    "src/shared/dates.js": lines(
      "/** ISO date (YYYY-MM-DD) of a Date. */",
      "export function isoDate(d) {",
      "  return d.toISOString().slice(0, 10);",
      "}",
      "",
      "/** Days between two dates. */",
      "export function daysBetween(a, b) {",
      "  return Math.round((b - a) / 86_400_000);",
      "}",
      "",
      "/** A copy of d moved by n days. */",
      "export function addDays(d, n) {",
      "  return new Date(d.getTime() + n * 86_400_000);",
      "}",
    ),
  },
};

/** Issues a new trunk starts with, so agents have work to pick from. */
export const TEMPLATE_ISSUES: Record<string, { title: string; body: string; labels: { name: string; color: string }[] }[]> = {
  shop: [
    issue("formatPrice should support other currencies", "Today it always prints dollars. Take a currency code and use Intl.NumberFormat.", "enhancement"),
    issue("total() counts items with negative quantities", "A cart with `qty: -1` lowers the total. Negative quantities should be ignored or rejected.", "bug"),
    issue("summary() says \"1 items\"", "Use formatQty so a single item reads \"1 item\".", "bug"),
    issue("Add a discount helper for carts", "`applyDiscount(items, percent)` returning a new total in cents.", "enhancement"),
    issue("slugify drops non-ASCII letters", "`slugify(\"Crème brûlée\")` gives `cr-me-br-l-e`. Normalise accents first.", "bug"),
    issue("round() returns -0 for small negatives", "`round(-0.001)` is `-0`, which prints as `0` but compares oddly.", "bug"),
    issue("truncate should not cut words in half", "Back off to the last space before the limit when there is one.", "enhancement"),
    issue("daysBetween is off by one across DST changes", "Use UTC dates so a day is always 86,400,000 ms.", "bug"),
    issue("Document the date helpers", "Every exported function in src/shared/dates.js needs an example.", "docs"),
    issue("Add tests for numbers.js", "Cover clamp, round, sum, mean and percent, including empty lists.", "tests"),
    issue("percent() with a fixed number of decimals", "`percent(1, 3, 1)` should give `33.3`.", "enhancement"),
    issue("Export everything from one index module", "Add src/index.js re-exporting the public helpers.", "refactor"),
  ],
};

function issue(title: string, body: string, label: string) {
  const color = { bug: "d73a4a", enhancement: "a2eeef", docs: "0075ca", tests: "fbca04", refactor: "c5def5" }[label] ?? "888888";
  return { title, body, labels: [{ name: label, color }] };
}

function lines(...ls: string[]) {
  return `${ls.join("\n")}\n`;
}
