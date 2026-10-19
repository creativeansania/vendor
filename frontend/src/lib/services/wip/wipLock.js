const locks = new Map();

/**
 * Sequential execution lock per resource key (e.g. `mo_123`, `wip_456`)
 */
export async function withWipLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  locks.set(key, prev.then(() => next, () => next));

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  }
}
