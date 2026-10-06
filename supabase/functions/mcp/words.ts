// The word index behind search on big accounts (mcp_word_index): for each note, its version, every
// distinct word in its text (lowercase) and the files it shows. Search reads the 64 sealed shards,
// keeps the notes whose words can match, and opens only those texts; a note whose version moved on
// is opened and indexed again as search meets it. A glob lists notes' files from it.
//
// It's a filter, never the answer: a note is kept when every word of the query (or every letter run
// of a grep pattern) is inside one of its words, then its real text decides.

import type { Call, Tx } from "./tools.ts";

const SHARDS = 64;
/** A note's entry: [version, " word word … ", [[file id, file name], …]]. */
type Entry = [string, string, [string, string][]];

const shardOf = (id: string) => parseInt(id.replace(/-/g, "").slice(-4), 16) % SHARDS;
const WORD = /[\p{L}\p{N}]+/gu;

/** The distinct words in a text, lowercase, as " a b c " (so " x" and "x " test word edges). */
export function wordsOf(text: string): string {
  return ` ${[...new Set(text.toLowerCase().match(WORD) ?? [])].join(" ")} `;
}

/** The letter runs a query or plain pattern needs: each must be inside some word of the note. */
export function needles(text: string): string[] {
  return [...new Set(text.toLowerCase().match(WORD) ?? [])].filter((w) => w.length >= 2);
}

async function gzip(s: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}
async function gunzip(b: Uint8Array): Promise<string> {
  return await new Response(new Blob([new Uint8Array(b)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

export class WordIndex {
  private shards: Map<number, Record<string, Entry>> = new Map();
  private dirty = new Set<number>();
  private constructor(readonly ms: number) {}

  static async load(tx: Tx, c: Call): Promise<WordIndex> {
    const t = performance.now();
    const rows = c.ctx.cold ? [] : await tx<{ shard: number; shard_ct: string }[]>`select shard, shard_ct from public.mcp_word_index`;
    const out = new WordIndex(0);
    await Promise.all(rows.map(async (r) => {
      try { out.shards.set(r.shard, JSON.parse(await gunzip(await c.v.openWordShard(r.shard, r.shard_ct)))); } catch { /* rebuilt as it's used */ }
    }));
    (out as { ms: number }).ms = Math.round(performance.now() - t);
    return out;
  }

  /** A note's entry when it's for this version. */
  get(id: string, version: string): Entry | undefined {
    const e = this.shards.get(shardOf(id))?.[id];
    return e && e[0] === version ? e : undefined;
  }
  set(id: string, version: string, text: string, files: [string, string][]) {
    const k = shardOf(id);
    const shard = this.shards.get(k) ?? this.shards.set(k, {}).get(k)!;
    shard[id] = [version, wordsOf(text), files];
    this.dirty.add(k);
  }
  /** Drops notes that no longer exist. */
  keep(live: Set<string>) {
    for (const [k, shard] of this.shards) for (const id of Object.keys(shard)) if (!live.has(id)) { delete shard[id]; this.dirty.add(k); }
  }
  /** Whether a note's words contain every needle. */
  static has(e: Entry, ns: string[]): boolean { return ns.every((n) => e[1].includes(n)); }
  /** How many needles a note's words contain. */
  static hits(e: Entry, ns: string[]): number { return ns.filter((n) => e[1].includes(n)).length; }
  files(id: string): [string, string][] { return this.shards.get(shardOf(id))?.[id]?.[2] ?? []; }
  get size(): number { let n = 0; for (const s of this.shards.values()) n += Object.keys(s).length; return n; }

  async save(tx: Tx, c: Call) {
    // A benchmark's call without the index never writes over it.
    if (c.ctx.cold) return;
    for (const k of this.dirty) {
      const sealed = await c.v.sealWordShard(k, await gzip(JSON.stringify(this.shards.get(k) ?? {})));
      await tx`insert into public.mcp_word_index (shard, shard_ct) values (${k}, ${sealed})
        on conflict (user_id, shard) do update set shard_ct = excluded.shard_ct, updated_at = now()`;
    }
    this.dirty.clear();
  }
}
