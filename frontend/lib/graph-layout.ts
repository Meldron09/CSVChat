import type { SchemaProfile } from "./api";

// Pure layout for the schema graph (no DOM, no dependency). Relative imports only: tests/graph-layout.spec.ts runs it in Node.

export const NODE_W = 144;
export const NODE_H = 48; // >= 44px touch target
const GAP_X = 56;
const GAP_Y = 48;
const LANE = 6; // edges sharing a gutter are offset by -LANE, 0 or +LANE
export const PAD = GAP_X / 2 + LANE; // room for the outer gutters (and the self-reference loops right of the last column)

export type Point = [number, number];
export type GraphNode = { name: string; rows: number; hub: boolean; x: number; y: number; w: number; h: number };
export type GraphEdge = { from: string; to: string; points: Point[] };
export type GraphLayout = { width: number; height: number; nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * Places every Table on a grid and routes every Relationship as an orthogonal polyline from the many side to the one side.
 *
 * Placement, on a grid (one Table per cell, so nodes never overlap): each connected component gets its own band of rows,
 * the hub's first (hub = the most connected Table; ties: more rows, then name). The component's best-ranked Table sits in the
 * middle of its band; the others follow in BFS order from it (so BFS depth from the hub is how far out a Table lands), each
 * taking the free cell cheapest to reach from its already-placed neighbours. A few improvement passes then move or swap
 * Tables (never the hub) while that shortens the total edge length (Manhattan, +0.5 for an edge that needs a bend).
 * Tables with no relationships at all pack row by row in a last band.
 *
 * Edges: neighbours in the same row or column with nothing between are joined straight; anything else runs through the
 * empty gutters between rows and columns, so no edge crosses a node. A self-reference is a small loop on the node's right.
 */
export function layoutGraph({ tables, relationships }: SchemaProfile): GraphLayout {
  if (tables.length === 0) return { width: 0, height: 0, nodes: [], edges: [] };
  const rows = new Map(tables.map((t) => [t.name, t.row_count]));
  const rels = relationships.filter((r) => rows.has(r.from_table) && rows.has(r.to_table));
  const nbrs = new Map(tables.map((t) => [t.name, new Set<string>()]));
  for (const r of rels) {
    if (r.from_table === r.to_table) continue;
    nbrs.get(r.from_table)!.add(r.to_table);
    nbrs.get(r.to_table)!.add(r.from_table);
  }
  const rank = (a: string, b: string) => nbrs.get(b)!.size - nbrs.get(a)!.size || rows.get(b)! - rows.get(a)! || (a < b ? -1 : a > b ? 1 : 0);
  const order = [...rows.keys()].sort(rank);
  const hub = order[0];
  const cols = order.length <= 4 ? order.length : Math.max(4, Math.ceil(Math.sqrt(2 * order.length)));

  type Cell = [number, number]; // [col, row]
  let cell = new Map<string, Cell>();
  let at = new Map<string, string>(); // "col,row" -> Table
  const key = ([c, r]: Cell) => `${c},${r}`;
  const put = (name: string, c: Cell) => {
    cell.set(name, c);
    at.set(key(c), name);
  };
  /** Moves `name` to `c`, swapping with whoever is there. Calling it again with the old cell undoes it. */
  const move = (name: string, c: Cell) => {
    const from = cell.get(name)!;
    const other = at.get(key(c));
    at.delete(key(from));
    put(name, c);
    if (other) put(other, from);
    return from;
  };
  const edgeCost = ([ac, ar]: Cell, [bc, br]: Cell) => Math.abs(ac - bc) + Math.abs(ar - br) + (ac !== bc && ar !== br ? 0.5 : 0);
  const costOf = (name: string) => [...nbrs.get(name)!].reduce((s, m) => s + (cell.has(m) ? edgeCost(cell.get(name)!, cell.get(m)!) : 0), 0);
  /** Lexicographic `a < b`. */
  const before = (a: number[], b: number[]) => {
    const i = a.findIndex((k, j) => k !== b[j]);
    return i >= 0 && a[i] < b[i];
  };

  let top = 0; // first row of the next band
  const singles: string[] = [];
  for (const root of order) {
    if (cell.has(root) || singles.includes(root)) continue;
    const comp = [root]; // BFS order
    for (let i = 0; i < comp.length; i++) for (const n of [...nbrs.get(comp[i])!].sort(rank)) if (!comp.includes(n)) comp.push(n);
    if (comp.length === 1) {
      singles.push(root);
      continue;
    }
    const w = Math.min(cols, comp.length);
    const h = Math.ceil(comp.length / w) + 1;
    const home: Cell = [Math.floor((w - 1) / 2), top + Math.floor((h - 1) / 2)];
    const band: Cell[] = [];
    for (let r = top; r < top + h; r++) for (let c = 0; c < w; c++) band.push([c, r]);
    put(root, home);
    for (const n of comp.slice(1)) {
      const anchors = [...nbrs.get(n)!].flatMap((m) => (cell.has(m) ? [cell.get(m)!] : []));
      let best: Cell | null = null;
      let bestKey: number[] = [];
      for (const c of band) {
        if (at.has(key(c))) continue;
        const k = [anchors.reduce((s, a) => s + edgeCost(c, a), 0), edgeCost(c, home), c[1], c[0]];
        if (!best || before(k, bestKey)) [best, bestKey] = [c, k];
      }
      put(n, best!); // the band has more cells than the component has Tables
    }
    // ponytail: greedy moves/swaps, a local optimum; a real crossing-minimising layout (e.g. dagre) if schemas outgrow it
    for (let pass = 0, better = true; better && pass < 20; pass++) {
      better = false;
      for (const n of comp.slice(1))
        for (const c of band) {
          const other = at.get(key(c));
          if (other === root || other === n) continue;
          const was = costOf(n) + (other ? costOf(other) : 0);
          const from = move(n, c);
          if (costOf(n) + (other ? costOf(other) : 0) < was - 1e-9) better = true;
          else move(n, from);
        }
    }
    top += h;
  }
  singles.forEach((name, i) => put(name, [i % cols, top + Math.floor(i / cols)]));

  // Drop empty rows and columns (a band may not fill all of its rows).
  const squeeze = (i: 0 | 1) => {
    const used = [...new Set([...cell.values()].map((c) => c[i]))].sort((a, b) => a - b);
    return new Map(used.map((v, j) => [v, j]));
  };
  const [colOf, rowOf] = [squeeze(0), squeeze(1)];
  const old = cell;
  cell = new Map();
  at = new Map();
  for (const [name, [c, r]] of old) put(name, [colOf.get(c)!, rowOf.get(r)!]);

  // Grid cells to pixels.
  const [nCols, nRows] = [colOf.size, rowOf.size];
  const rect = ([c, r]: Cell) => {
    const x = PAD + c * (NODE_W + GAP_X);
    const y = PAD + r * (NODE_H + GAP_Y);
    return { l: x, r: x + NODE_W, t: y, b: y + NODE_H, cx: x + NODE_W / 2, cy: y + NODE_H / 2 };
  };

  const nodes: GraphNode[] = order.map((name) => {
    const { l, t } = rect(cell.get(name)!);
    return { name, rows: rows.get(name)!, hub: name === hub && nbrs.get(hub)!.size > 0, x: l, y: t, w: NODE_W, h: NODE_H };
  });

  const clear = (a: Cell, b: Cell) => {
    const [dc, dr] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    for (let c = a[0] + dc, r = a[1] + dr; c !== b[0] || r !== b[1]; c += dc, r += dr) if (at.has(key([c, r]))) return false;
    return true;
  };

  let lane = 0;
  // one_to_one has no many side: it is drawn from_table -> to_table, like many_to_one.
  const edges: GraphEdge[] = rels.map(({ from_table: from, to_table: to }) => {
    const a = cell.get(from)!;
    const b = cell.get(to)!;
    const A = rect(a);
    const B = rect(b);
    let points: Point[];
    if (from === to) {
      points = [[A.r, A.cy - 10], [A.r + 16, A.cy - 10], [A.r + 16, A.cy + 10], [A.r, A.cy + 10]];
    } else if (a[1] === b[1] && clear(a, b)) {
      points = b[0] > a[0] ? [[A.r, A.cy], [B.l, B.cy]] : [[A.l, A.cy], [B.r, B.cy]];
    } else if (a[0] === b[0] && clear(a, b)) {
      points = b[1] > a[1] ? [[A.cx, A.b], [B.cx, B.t]] : [[A.cx, A.t], [B.cx, B.b]];
    } else {
      // ponytail: fixed 3 lanes per gutter; edges sharing a gutter beyond that overlap. Add per-gutter lane counting if dense schemas need it.
      const offset = ((lane++ % 3) - 1) * LANE;
      const down = b[1] >= a[1]; // same row: run through the gutter below it
      const gy = (down ? A.b + GAP_Y / 2 : A.t - GAP_Y / 2) + offset;
      const start: Point = [A.cx, down ? A.b : A.t];
      if (Math.abs(b[1] - a[1]) <= 1 && a[0] !== b[0]) {
        // the gutter also borders B: drop straight into it
        points = [start, [A.cx, gy], [B.cx + offset, gy], [B.cx + offset, b[1] > a[1] ? B.t : B.b]];
      } else {
        // two or more rows apart: along a column gutter beside B, then into its side
        const left = b[0] >= a[0];
        const gx = (left ? B.l - GAP_X / 2 : B.r + GAP_X / 2) + offset;
        points = [start, [A.cx, gy], [gx, gy], [gx, B.cy], [left ? B.l : B.r, B.cy]];
      }
    }
    return { from, to, points };
  });

  return {
    width: 2 * PAD + nCols * NODE_W + (nCols - 1) * GAP_X,
    height: 2 * PAD + nRows * NODE_H + (nRows - 1) * GAP_Y,
    nodes,
    edges,
  };
}
