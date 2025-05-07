/**
 * Expands or truncates a vector to the target dimension.
 * If expanding, it duplicates values. If truncating, it slices.
 * Normalizes the resulting vector to maintain unit length if expanded.
 * @param {number[]} vector - Original vector.
 * @param {number} targetDim - Target dimension.
 * @returns {number[]|null} - Expanded or truncated vector, or null if input vector is invalid.
 */
function expandVector(vector, targetDim) {
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    // console.error('[expandVector] Invalid input vector.'); // Consider using a logger if available
    return null;
  }

  if (vector.length === targetDim) {
    return vector;
  }

  if (vector.length > targetDim) {
    // Truncate if vector is too long
    return vector.slice(0, targetDim);
  }

  // Expand by duplicating values
  const expandedVector = new Array(targetDim).fill(0);

  // Copy original values
  for (let i = 0; i < vector.length; i++) {
    expandedVector[i] = vector[i];
  }

  // Fill remaining positions by cycling through the original vector
  for (let i = vector.length; i < targetDim; i++) {
    expandedVector[i] = vector[i % vector.length];
  }

  // Normalize to maintain unit length only if expanded
  // (Truncating doesn't necessarily require re-normalization depending on use case,
  // but for consistency with how it might have been used for expansion, let's normalize)
  const magnitude = Math.sqrt(expandedVector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) {
    // console.warn('[expandVector] Vector has zero magnitude after expansion/padding.');
    return expandedVector; // Return zero vector if magnitude is zero
  }
  return expandedVector.map(val => val / magnitude);
}

module.exports = {
  expandVector,
}; 