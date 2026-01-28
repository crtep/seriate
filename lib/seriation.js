/**
 * Seriation algorithm: reorder items so that similar ones are adjacent.
 * Uses greedy nearest-neighbor traversal on a cosine distance matrix.
 */

/**
 * Compute cosine distance between two vectors.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Distance in [0, 2]
 */
function cosineDistance(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/**
 * Build a pairwise cosine distance matrix.
 *
 * @param {number[][]} embeddings
 * @returns {number[][]} Symmetric distance matrix
 */
function buildDistanceMatrix(embeddings) {
  const n = embeddings.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = cosineDistance(embeddings[i], embeddings[j]);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }

  return matrix;
}

/**
 * Seriate a list of items using greedy nearest-neighbor.
 * Returns an ordering (array of original indices) such that
 * adjacent items in the ordering are similar.
 *
 * @param {number[][]} embeddings - Array of embedding vectors
 * @returns {number[]} Ordered indices into the embeddings array
 */
function seriate(embeddings) {
  const n = embeddings.length;
  if (n <= 1) return n === 1 ? [0] : [];

  const dist = buildDistanceMatrix(embeddings);
  const visited = new Set();
  /** @type {number[]} */
  const order = [];

  // Start from index 0
  let current = 0;
  visited.add(current);
  order.push(current);

  while (order.length < n) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let j = 0; j < n; j++) {
      if (!visited.has(j) && dist[current][j] < bestDist) {
        bestDist = dist[current][j];
        bestIdx = j;
      }
    }

    visited.add(bestIdx);
    order.push(bestIdx);
    current = bestIdx;
  }

  return order;
}
