import type { SchemaProfile } from "./api";

// Pure: tests/starter-questions.spec.ts runs it in Node (relative imports only).

export type StarterQuestion = { question: string; uses: string[] };
type Table = SchemaProfile["tables"][number];

const isId = (name: string) => /(^|_)id$/i.test(name);
const measures = (t: Table) => t.columns.filter((c) => /int|numeric|decimal|double|real|float/i.test(c.type) && !isId(c.name));
const dates = (t: Table) => t.columns.filter((c) => /date|timestamp/i.test(c.type));
const texts = (t: Table) => t.columns.filter((c) => /text|char|string/i.test(c.type) && !isId(c.name));
const CATEGORY = /(^|_)(category|type|status|method|carrier|region|country|city|state|segment|channel|brand|gender|department)$/i;

const human = (name: string) => name.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// ponytail: English plural of the last word only; good enough for table names
const plural = (s: string) => (/s$/i.test(s) ? s : /[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`);

/**
 * Exactly four starter questions from the Schema Profile (none for an empty one), most specific first:
 * a measure by month (a Table with a date and a numeric column), "Top 10 X by Y" across a many-to-one Relationship,
 * a count per category-like text column, "Which X have the most Y?" across a Relationship; then generic questions about
 * the largest Table, so any non-empty dataset gets four. `uses` names the Tables involved.
 */
export function starterQuestions({ tables, relationships }: SchemaProfile): StarterQuestion[] {
  if (tables.length === 0) return [];
  const byRows = [...tables].sort((a, b) => b.row_count - a.row_count || (a.name < b.name ? -1 : 1));
  const table = new Map(tables.map((t) => [t.name, t]));
  const rels = relationships.filter((r) => r.cardinality === "many_to_one" && r.from_table !== r.to_table && table.has(r.from_table) && table.has(r.to_table));
  const out: StarterQuestion[] = [];
  const used = new Set<string>();
  const add = (question: string, uses: string[]) => {
    if (out.some((q) => q.question === question)) return;
    out.push({ question, uses });
    uses.forEach((u) => used.add(u));
  };
  /** The first match, preferring ones whose Tables are not used by an earlier question. */
  const fresh = <T>(items: T[], tablesOf: (x: T) => string[]) => items.find((x) => !tablesOf(x).some((t) => used.has(t))) ?? items[0];

  const timed = byRows.find((t) => dates(t).length > 0 && measures(t).length > 0);
  if (timed) add(`${cap(human(measures(timed)[0].name))} by month over the past year`, [timed.name]);

  const top = fresh(rels.filter((r) => measures(table.get(r.from_table)!).length > 0), (r) => [r.to_table]);
  if (top) add(`Top 10 ${plural(human(top.to_table))} by ${human(measures(table.get(top.from_table)!)[0].name)}`, [top.from_table, top.to_table]);

  const categorised = fresh(byRows.filter((t) => texts(t).some((c) => CATEGORY.test(c.name))), (t) => [t.name]);
  if (categorised) {
    const col = texts(categorised).find((c) => CATEGORY.test(c.name))!;
    add(`How many ${plural(human(categorised.name))} are there per ${human(col.name)}?`, [categorised.name]);
  }

  const most = fresh(rels, (r) => [r.from_table, r.to_table]);
  if (most) add(`Which ${plural(human(most.to_table))} have the most ${plural(human(most.from_table))}?`, [most.from_table, most.to_table]);

  const big = byRows[0];
  const name = human(big.name);
  add(`How many ${plural(name)} are there?`, [big.name]);
  if (measures(big).length > 0) add(`What are the highest and lowest ${human(measures(big)[0].name)} values in ${name}?`, [big.name]);
  if (texts(big).length > 0) add(`What are the most common values of ${human(texts(big)[0].name)} in ${name}?`, [big.name]);
  add(`What does a typical row in ${name} look like?`, [big.name]);
  add(`Which columns in ${name} have missing values?`, [big.name]);
  add(`Summarise ${name} in a few sentences.`, [big.name]);
  return out.slice(0, 4);
}
