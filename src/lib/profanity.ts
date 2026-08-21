import { Trie, type Match } from "@/lib/trie";
import { allowlist, blocklist } from "@/lib/words";

type Span = { start: number; end: number };

const CONTRACTIONS = new Set(["d", "ll", "m", "re", "s", "t", "ve"]);
const KEEP_TWO = new Set(["e", "l", "o", "s"]);

const blockTrie = new Trie(blocklist);
const allowTrie = new Trie(allowlist);

export function check(text: string): boolean {
  return findSpans(text).length > 0;
}

export function censor(text: string): string {
  const spans = findSpans(text);
  if (spans.length === 0) {
    return text;
  }

  let result = "";
  let cursor = 0;
  for (const span of spans) {
    result += text.slice(cursor, span.start);
    result += "*".repeat(span.end - span.start);
    cursor = span.end;
  }
  result += text.slice(cursor);
  return result;
}

function findSpans(text: string): Span[] {
  const { transformed, indexMap } = normalize(text);
  const allowSpans = toOriginalSpans(allowTrie.search(transformed), indexMap, text);
  const blockSpans = toOriginalSpans(blockTrie.search(transformed), indexMap, text);

  const uncovered = blockSpans.filter(
    (span) => !allowSpans.some((allow) => span.start >= allow.start && span.end <= allow.end),
  );

  return mergeSpans(uncovered);
}

function normalize(input: string): { transformed: string; indexMap: number[] } {
  const chars = [...codepoints(input)];
  let transformed = "";
  const indexMap: number[] = [];
  let lastLetter: string | null = null;
  let run = 0;
  let lastWasSpace = false;

  for (let i = 0; i < chars.length; i++) {
    const { ch, index } = chars[i];
    const folded = ch.normalize("NFKC").toLowerCase();

    for (const unit of folded) {
      if (/\s/u.test(unit)) {
        if (!lastWasSpace && transformed.length > 0) {
          transformed += " ";
          indexMap.push(index);
        }
        lastWasSpace = true;
        lastLetter = null;
        run = 0;
        continue;
      }

      lastWasSpace = false;

      if (unit === "'" || unit === "\u2019") {
        if (CONTRACTIONS.has(letterRunAfter(chars, i + 1))) {
          transformed += "'";
          indexMap.push(index);
        }
        lastLetter = null;
        run = 0;
        continue;
      }

      if (!isLetter(unit)) {
        lastLetter = null;
        run = 0;
        continue;
      }

      const limit = KEEP_TWO.has(unit) ? 2 : 1;
      if (unit === lastLetter) {
        run += 1;
        if (run > limit) {
          continue;
        }
      } else {
        lastLetter = unit;
        run = 1;
      }

      transformed += unit;
      indexMap.push(index);
    }
  }

  if (transformed.endsWith(" ")) {
    transformed = transformed.slice(0, -1);
    indexMap.pop();
  }

  return { transformed, indexMap };
}

function toOriginalSpans(hits: Match[], indexMap: number[], original: string): Span[] {
  return hits.map((hit) => {
    const start = indexMap[hit.start];
    const last = indexMap[hit.end - 1];
    const lastChar = String.fromCodePoint(original.codePointAt(last)!);
    return { start, end: last + lastChar.length };
  });
}

function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) {
    return [];
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function letterRunAfter(chars: { ch: string; index: number }[], start: number): string {
  let run = "";
  for (let i = start; i < chars.length; i++) {
    const folded = chars[i].ch.normalize("NFKC").toLowerCase();
    for (const unit of folded) {
      if (!isLetter(unit)) {
        return run;
      }
      run += unit;
    }
  }
  return run;
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function* codepoints(text: string): Generator<{ ch: string; index: number }> {
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    yield { ch, index: i };
    i += ch.length;
  }
}
