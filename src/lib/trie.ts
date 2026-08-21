/**
 * Half-open `[start, end)` span in Unicode code point indices.
 */
export type Match = { start: number; end: number };

/**
 * An Aho-Corasick trie for multi-pattern matching.
 */
export class Trie {
  private readonly root: TrieNode;

  constructor(words: string[]) {
    this.root = Trie.build(words);
  }

  /**
   * Finds every stored pattern in `text`, including overlaps.
   * @param text A string to search through.
   * @returns An array of matches, each match represented as half-open spans in
   * code point indices of `text`.
   */
  search(text: string): Match[] {
    const points = [...text];
    const hits: Match[] = [];

    let node = this.root;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];

      // If the current node is a dead end, navigate to the failure link.
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

  /**
   * Builds a new Aho-Corasick trie, populating it with the code points of each
   * string in `words`. After the trie is populated, breadth-first search (BFS)
   * is used to create failure links.
   * @param words An array of words to populate the trie with.
   * @returns The node representing the root of the trie.
   */
  private static build(words: string[]): TrieNode {
    const root = new TrieNode();

    for (const word of words) {
      const points = [...word];
      if (points.length === 0) {
        continue;
      }

      let node = root;

      for (const point of points) {
        let child = node.next.get(point);
        if (child == null) {
          child = new TrieNode();

          // Every node initially has a failure link to the root node. This
          // will be overwritten (if applicable) during the failure link phase.
          child.fail = root;

          node.next.set(point, child);
        }
        node = child;
      }

      node.outputs.push(points.length);
    }

    // Use breadth-first search (BFS) to wire failure links.
    const queue: TrieNode[] = [...root.next.values()];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];

      for (const [point, child] of node.next) {
        let fail = node.fail;

        // Walk the parent’s failure chain until a node continues with this
        // code point.
        while (fail !== root && !fail.next.has(point)) {
          fail = fail.fail;
        }

        child.fail = fail.next.get(point) ?? root;
        child.outputs.push(...child.fail.outputs);

        queue.push(child);
      }
    }

    return root;
  }
}

/**
 * A node of an Aho-Corasick trie.
 */
class TrieNode {
  /**
   * The edges of the node, represented as a map of nodes keyed by a Unicode
   * code point string.
   */
  next = new Map<string, TrieNode>();

  /**
   * The failure link, or a node representing the longest suffix of this path
   * that is still a prefix of some word.
   *
   * During search, the failure link will be followed when the current node is
   * a dead end.
   */
  fail: TrieNode = this;

  /**
   * An array storing the lengths of patterns that end at this node, including
   * those inherited from the failure link.
   */
  outputs: number[] = [];
}
