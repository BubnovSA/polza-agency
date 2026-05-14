/**
 * Pause execution for exactly `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pause for a random duration between `min` and `max` ms.
 * Mimics human browsing rhythm — makes request intervals unpredictable.
 * @param {number} min
 * @param {number} max
 * @returns {Promise<void>}
 */
export function randomSleep(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(ms);
}
