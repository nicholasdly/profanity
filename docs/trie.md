# The trie

`src/lib/trie.ts` is an [Aho–Corasick](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm) automaton: a trie holding every word in a list, plus failure links that let a single left-to-right scan of the text report every occurrence of every word, including overlapping ones.

It is the matching engine behind the `check` and `censor` endpoints. `src/lib/profanity.ts` builds two of them at module load — `blockTrie` over the blocklist, `allowTrie` over the allowlist — and asks each one where its words appear in the normalized text.

This document has two parts. The first is conceptual: what the trie is for, and why this structure rather than a simpler one. The second walks the implementation.

---

## Overview and concepts

### What problem does the trie solve?

The service holds two fixed word lists — a few dozen blocked words, and roughly a hundred allowlist entries that exist to stop the [Scunthorpe problem](./profanity-detection-research.md#7-false-positives-an-empirical-catalogue). For each request it needs to answer:

> Given this text, where does **every** word from this list occur?

Three properties of that question drive the whole design.

**It needs spans, not a verdict.** `censor` replaces matched ranges with asterisks, so it needs `start` and `end`, not a boolean. And the allowlist only works positionally: `assistant` is fine, `ass` is not, so the filter has to know that the `ass` match sits _inside_ the `assistant` match before it can drop it. A matcher that returns "yes, something matched" cannot support that.

**It needs overlaps.** The lists overlap heavily by construction — `ass` and `asses`, `hell` and `hello`, `cock` and `cockpit`. A matcher that commits to one winner per position has already made a policy decision. The trie reports all of them and leaves the resolution to `findSpans`, which drops blocked matches covered by an allowed match and then merges what remains.

**It needs substring matching, not word matching.** Obfuscated input like `f.u.c.k` is normalized before matching, which destroys the original separators, so word boundaries in the normalized string are not trustworthy. The matcher works on a raw sequence of code points and the allowlist absorbs the false positives that substring matching creates.

The dictionary is also fixed and known at startup while the text is short and different every request. That asymmetry says: preprocess the dictionary once, then make each search as cheap as possible. This is exactly what Aho–Corasick is built to do, and it fits a stateless HTTP service well — the two automata are constructed at module load and reused by every request for the lifetime of the process.

### Why a trie, compared to other common approaches?

The alternatives and their failure modes, summarized from [§8 of the research briefing](./profanity-detection-research.md#8-matching-engines):

| Approach                              | Cost             | Why it was not used                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text.includes(word)` per entry       | O(n·m)           | Re-scans the whole text once per list entry, ~150 times here. Returns booleans, not all occurrences.                                                                                                                                                                                                                                                                            |
| Hash set over whitespace tokens       | O(n)             | Fast and precise, but can only find whole tokens. Misses anything embedded (`fuckingidiot`), and normalization has already removed the separators the tokenizer would rely on.                                                                                                                                                                                                  |
| Regex alternation built from the list | Engine-dependent | Does not report overlaps without lookahead contortions, so the allowlist containment check becomes awkward. Degrades unpredictably past a few hundred patterns. Worst of all, a backtracking engine fed attacker-controlled text through a pattern assembled from a wordlist is a [ReDoS](./profanity-detection-research.md#redos-the-argument-that-is-usually-missed) surface. |
| Trie                                  | O(n · maxDepth)  | Correct and simple; shares prefixes so `ass`/`asses`/`asshole` cost one `ass` path. Restarts the walk on every mismatch.                                                                                                                                                                                                                                                        |
| Aho–Corasick                          | O(n + z)         | A trie plus failure links. One pass, all overlaps, no restarts.                                                                                                                                                                                                                                                                                                                 |

The trie wins the shortlist for three reasons. It naturally shares prefixes, so list size costs memory rather than search time. It walks the text position by position, which means match spans fall out of the traversal for free. And it is a deterministic automaton with no backtracking, so there is no catastrophic input — a security property for a public endpoint, not a micro-optimization.

### Why an Aho–Corasick trie compared to a standard trie?

A plain trie answers one question: _does this exact path exist from the root?_ To find matches anywhere in the text you have to ask it that question once per starting position — start at the root at index 0, walk until you fall off, then start again at the root at index 1. Work already done is thrown away on every mismatch, and the cost becomes O(n · maxDepth) where `maxDepth` is the longest word in the list (`assassination`, 13 code points).

Aho–Corasick keeps that work. Two additions do it:

**Failure links.** Every node gets a pointer to the node representing the longest proper suffix of its own path that is still a prefix of some word in the list. When the walk hits a dead end, following that pointer is equivalent to restarting from the best possible later position without moving the cursor backwards. It is Knuth–Morris–Pratt generalized from one pattern to a whole dictionary.

**Inherited outputs.** A node also copies the reported words of its failure target. This is what makes overlaps free: landing on the `e` of `she` already knows that `he` ended here too, so search never walks the failure chain just to collect results.

The practical differences:

|                         | Plain trie                     | Aho–Corasick                    |
| ----------------------- | ------------------------------ | ------------------------------- |
| Passes over the text    | One per starting position      | One, total                      |
| Search cost             | O(n · maxDepth)                | O(n + z), z = number of matches |
| Sensitive to list size? | Only through `maxDepth`        | No — construction absorbs it    |
| Overlapping matches     | Extra bookkeeping per position | Free, via inherited outputs     |
| Extra code              | —                              | One BFS at build time           |

The last row is the point worth stressing: the automaton is a plain trie plus roughly fifteen lines of breadth-first traversal, paid once at startup. The search loop actually gets _simpler_, because it never rewinds.

---

## Implementation

### Public surface

Two exports:

```ts
export type Match = { start: number; end: number };

export class Trie {
  constructor(words: string[]);
  search(text: string): Match[];
}
```

`new Trie(words)` builds an immutable automaton. `search` returns a half-open `[start, end)` span for every occurrence of every word.

Note what `Match` does _not_ carry: which word matched, or which list it came from. The nodes store pattern _lengths_, not the patterns themselves, and the span is derived from the length and the current position. Callers that need the word can slice the text; `profanity.ts` never needs to.

### Code points, not characters

`Match` indices are **Unicode code point** indices, not UTF-16 offsets, and the automaton's edges are labeled with code points.

This distinction is load-bearing. A JavaScript string is a sequence of 16-bit code units, and `length`, `charAt`, and `s[i]` all count those units. Anything outside the Basic Multilingual Plane — most emoji, many symbols, some CJK — is stored as a surrogate pair: two units for one visual character. Indexing that way would split a single character across two trie edges and report match lengths that are wrong for any input containing one.

Spreading a string (`[...text]`) uses the string iterator, which yields one entry per code point, so `"💩".length` is `2` but `[..."💩"].length` is `1`. Both `build` and `search` spread their input for exactly this reason.

The word "character" is avoided in the code and here because it is ambiguous between three things: a UTF-16 code unit, a code point, and a grapheme cluster (`é` as `e` plus a combining accent, or an emoji family joined by ZWJ). The automaton operates on code points, and callers convert at the boundary — see `toOriginalSpans` in `profanity.ts`.

### `TrieNode`

Every node means "I have followed this prefix so far." It holds three fields.

| Field     | Type                    | Meaning                                                                                                                                |
| --------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `next`    | `Map<string, TrieNode>` | Outgoing edges, keyed by a single code point                                                                                           |
| `fail`    | `TrieNode`              | The longest proper suffix of this path that is also a prefix of some word. Followed when `next` has no edge for the current code point |
| `outputs` | `number[]`              | Lengths of the words that end here, including those inherited from `fail`                                                              |

`fail` is declared as `fail: TrieNode = this`, so a freshly constructed node points at itself. Only the root keeps that value, and self-reference is the correct base case for it: the root is the "nowhere left to fall back to" node, and both loops in the file terminate on identity with the root rather than on a null check.

`outputs` stores lengths because a length plus an end index is a span, which is all a caller needs. It cannot accumulate duplicates from inheritance either: a node's own output equals its depth, and everything inherited comes from a strictly shorter proper suffix. (Duplicate words in the input list _would_ push duplicate lengths. The lists are unique.)

### Build, phase 1: insert every word

`Trie.build` walks each word code point by code point, creating nodes as needed, and records the word's length on the final node.

```ts
for (const point of points) {
  let child = node.next.get(point);
  if (child == null) {
    child = new TrieNode();
    child.fail = root;
    node.next.set(point, child);
  }
  node = child;
}

node.outputs.push(points.length);
```

Two details are easy to skim past.

`child.fail = root` is not merely a safe default. The BFS in phase 2 starts from the root's children and wires each node's _children_, so depth-1 nodes are never assigned a failure link there. This line is what gives them one — and `root` is the right answer, since a single code point has no proper suffix that could be a prefix.

The empty-string guard (`if (points.length === 0) continue`) prevents pushing `0` onto `root.outputs`, which would report a zero-length match at every position in every text.

For the dictionary used in `tests/lib/trie.test.ts` — `["he", "her", "hers", "she", "ushers"]` — insertion produces:

```text
root
├─ h ─ e ─ r ─ s              outputs: he [2], her [3], hers [4]
├─ s ─ h ─ e                  outputs: she [3]
└─ u ─ s ─ h ─ e ─ r ─ s      outputs: ushers [6]
```

Note that `she` and `ushers` do not share the `s ─ h ─ e` path. A trie shares _prefixes_, and `she` is a suffix inside `ushers`, not a prefix of it. Failure links are what connect them.

### Build, phase 2: wire failure links with BFS

This is the Aho–Corasick part. For every node, find the longest proper suffix of its path that is still a prefix in the trie.

```ts
const queue: TrieNode[] = [...root.next.values()];
for (let i = 0; i < queue.length; i++) {
  const node = queue[i];

  for (const [point, child] of node.next) {
    let fail = node.fail;

    while (fail !== root && !fail.next.has(point)) {
      fail = fail.fail;
    }

    child.fail = fail.next.get(point) ?? root;
    child.outputs.push(...child.fail.outputs);

    queue.push(child);
  }
}
```

The rule is: to find the failure link of a child reached by `point`, start at the _parent's_ failure link and follow the failure chain until some node has an edge labeled `point`. Take that edge. If the chain reaches the root without finding one, fail to the root.

Then copy the failure target's outputs. Breadth-first order is what makes this correct: a node's failure target is always strictly closer to the root, so it has already been processed and its `outputs` are already complete. One copy is enough; there is no need to walk the chain.

Two implementation notes. The queue is an array with a moving index rather than `shift()`, keeping enqueue and dequeue O(1). And the traversal terminates because every node is pushed exactly once, when its parent is processed.

Applied to the example dictionary:

| Node          | `fail` | Why                                                             | `outputs` after |
| ------------- | ------ | --------------------------------------------------------------- | --------------- |
| `h`, `s`, `u` | `root` | Depth 1, set during insertion                                   | —               |
| `he`          | `root` | `e` is not a prefix of any word                                 | `[2]`           |
| `sh`          | `h`    | `h` is a prefix of `he`                                         | `[]`            |
| `us`          | `s`    | `s` is a prefix of `she`                                        | `[]`            |
| `her`         | `root` | `er`, `r` are not prefixes                                      | `[3]`           |
| `she`         | `he`   | `he` is in the trie                                             | `[3, 2]`        |
| `ush`         | `sh`   | `sh` is a prefix of `she`                                       | `[]`            |
| `hers`        | `s`    | `s` is a prefix of `she`                                        | `[4]`           |
| `ushe`        | `she`  | `she` is in the trie                                            | `[3, 2]`        |
| `usher`       | `her`  | `she` has no `r` edge, so the chain goes `she → he`, which does | `[3]`           |
| `ushers`      | `hers` | `her` has an `s` edge                                           | `[6, 4]`        |

The `she → [3, 2]` row is the mechanism that makes `"she"` also report `"he"`. The `ushers → [6, 4]` row is why `"ushers"` reports `"hers"` too.

### Search

One pass over the text, three steps per code point.

```ts
search(text: string): Match[] {
  const points = [...text];
  const hits: Match[] = [];

  let node = this.root;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];

    while (node !== this.root && !node.next.has(point)) {
      node = node.fail;
    }

    node = node.next.get(point) ?? this.root;
    for (const length of node.outputs) {
      hits.push({ start: i + 1 - length, end: i + 1 });
    }
  }

  return hits;
}
```

1. **Fall back while stuck.** If the current node has no edge for this code point, follow `fail` until one does, or until the root is reached.
2. **Take the edge.** After the loop the node either has the edge or is the root; `?? this.root` covers the case where the root has no edge for this code point either, meaning "no partial match is alive, start fresh."
3. **Report.** Every length in `outputs` is a word ending at this position, so the span is `[i + 1 - length, i + 1)`.

The cursor `i` only ever moves forward. Failure links move the _node_, never the position, which is why the pass is linear.

Tracing `"ushes"` against the example dictionary:

| `i` | Point | Walk                                                                                        | Node   | Reported                      |
| --- | ----- | ------------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| 0   | `u`   | root has `u`                                                                                | `u`    | —                             |
| 1   | `s`   | `u` has `s`                                                                                 | `us`   | —                             |
| 2   | `h`   | `us` has `h`                                                                                | `ush`  | —                             |
| 3   | `e`   | `ush` has `e`                                                                               | `ushe` | `she` `[1, 4)`, `he` `[2, 4)` |
| 4   | `s`   | `ushe` has no `s`; fail to `she`, no `s`; fail to `he`, no `s`; fail to root, which has `s` | `s`    | —                             |

Step 3 shows inherited outputs paying off: the walk has never visited the `she` or `he` nodes, yet both words are reported. Step 4 shows the failure chain replacing three restarted scans with three pointer hops. Searching `"ushers"` instead yields five matches — `ushers`, `usher`'s inherited `her`, plus `she`, `he`, and `hers` — which is the case pinned by `tests/lib/trie.test.ts`.

Results come back grouped by end position, with each node's own word before its inherited ones. They are **not** sorted by `start`, and they are not deduplicated across overlapping spans. `profanity.ts` sorts in `mergeSpans`.

### Complexity and limits

**Search** is O(n + z) in the number of code points and matches. The failure-link loop looks like it could be quadratic, but it is amortized: each hop strictly decreases the current node's depth, and depth only grows by one per input code point. `[...text]` allocates one array per call, which is O(n) extra memory and the reason `search` takes a string rather than requiring callers to pre-split.

**Construction** is roughly linear in the total number of code points across all words, one node per distinct prefix. It is paid once per process, which is why `profanity.ts` builds both tries at module scope rather than per request.

**Eager output copying has a worst case.** For a pathological dictionary like `a`, `aa`, `aaa`, …, `aⁿ`, each node inherits from the one above it and total output storage is quadratic. This is a real property of the trade — copying at build time to keep search branch-free — and it is a non-issue for word lists of natural language, where suffix chains are short.

**No input cap here.** The trie is linear, but it does not bound anything on its own. Request size limits belong at the API boundary.

### How `profanity.ts` uses it

The tries never see raw user input. `normalize` first applies NFKC and lowercases, then collapses repeated letters, skips non-letters, and preserves English contractions, building a `transformed` string alongside an `indexMap` recording which original offset each output code point came from. Then:

```ts
const allowSpans = toOriginalSpans(allowTrie.search(transformed), indexMap, text);
const blockSpans = toOriginalSpans(blockTrie.search(transformed), indexMap, text);
```

`toOriginalSpans` maps each code-point span in normalized space back to a UTF-16 span in the original string, which is what lets `b.i.t.c.h` be censored across the punctuation it was hiding behind. `findSpans` then drops any blocked span fully contained in an allowed span and merges the survivors, so `censor` can splice the original text in one left-to-right pass.

The division of labor is deliberate. The trie is a complete matcher: it reports everything it finds and decides nothing. Which match wins, and what happens to it, lives in `profanity.ts`.
