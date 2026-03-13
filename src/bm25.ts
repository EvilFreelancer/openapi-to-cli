/**
 * Generic BM25 search engine.
 * Ported from github.com/sipeed/picoclaw/pkg/utils/bm25.go
 *
 * Usage:
 *   const engine = new BM25Engine(docs, (d) => d.name + " " + d.description);
 *   const results = engine.search("my query", 5);
 */

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

export interface BM25Options {
  k1?: number;
  b?: number;
}

export interface BM25Result<T> {
  document: T;
  score: number;
}

export class BM25Engine<T> {
  private corpus: T[];
  private textFunc: (doc: T) => string;
  private k1: number;
  private b: number;

  constructor(corpus: T[], textFunc: (doc: T) => string, opts?: BM25Options) {
    this.corpus = corpus;
    this.textFunc = textFunc;
    this.k1 = opts?.k1 ?? DEFAULT_K1;
    this.b = opts?.b ?? DEFAULT_B;
  }

  search(query: string, topK: number): BM25Result<T>[] {
    if (topK <= 0) return [];

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const N = this.corpus.length;
    if (N === 0) return [];

    // Step 1: build per-document tf + raw doc lengths
    const entries: Array<{ tf: Map<string, number>; rawLen: number }> = [];
    const df = new Map<string, number>();
    let totalLen = 0;

    for (const doc of this.corpus) {
      const tokens = tokenize(this.textFunc(doc));
      totalLen += tokens.length;

      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
      for (const t of tf.keys()) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
      entries.push({ tf, rawLen: tokens.length });
    }

    const avgDocLen = totalLen / N;

    // Step 2: IDF (Robertson smoothing)
    const idf = new Map<string, number>();
    for (const [term, freq] of df) {
      idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }

    // docLenNorm[i] = k1 * (1 - b + b * |doc_i| / avgDocLen)
    const docLenNorm: number[] = entries.map(
      (e) => this.k1 * (1 - this.b + this.b * e.rawLen / avgDocLen)
    );

    // Step 3: inverted index (posting lists)
    const posting = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
      for (const term of entries[i].tf.keys()) {
        let list = posting.get(term);
        if (!list) {
          list = [];
          posting.set(term, list);
        }
        list.push(i);
      }
    }

    // Step 4: score via posting lists
    const unique = dedupe(queryTerms);
    const scores = new Map<number, number>();

    for (const term of unique) {
      const termIDF = idf.get(term);
      if (termIDF === undefined) continue;

      const docs = posting.get(term);
      if (!docs) continue;

      for (const docID of docs) {
        const freq = entries[docID].tf.get(term) ?? 0;
        const tfNorm = (freq * (this.k1 + 1)) / (freq + docLenNorm[docID]);
        scores.set(docID, (scores.get(docID) ?? 0) + termIDF * tfNorm);
      }
    }

    if (scores.size === 0) return [];

    // Step 5: top-K via min-heap
    const heap: Array<{ docID: number; score: number }> = [];

    for (const [docID, sc] of scores) {
      if (heap.length < topK) {
        heap.push({ docID, score: sc });
        if (heap.length === topK) {
          minHeapify(heap);
        }
      } else if (sc > heap[0].score) {
        heap[0] = { docID, score: sc };
        siftDown(heap, 0);
      }
    }

    heap.sort((a, b) => b.score - a.score);

    return heap.map((h) => ({
      document: this.corpus[h.docID],
      score: h.score,
    }));
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[.,;:!?"'()/\\-_]+|[.,;:!?"'()/\\-_]+$/g, ""))
    .filter((t) => t.length > 0);
}

function dedupe(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function minHeapify(h: Array<{ score: number }>): void {
  for (let i = Math.floor(h.length / 2) - 1; i >= 0; i--) {
    siftDown(h, i);
  }
}

function siftDown(h: Array<{ score: number }>, i: number): void {
  const n = h.length;
  for (;;) {
    let smallest = i;
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < n && h[l].score < h[smallest].score) smallest = l;
    if (r < n && h[r].score < h[smallest].score) smallest = r;
    if (smallest === i) break;
    [h[i], h[smallest]] = [h[smallest], h[i]];
    i = smallest;
  }
}
