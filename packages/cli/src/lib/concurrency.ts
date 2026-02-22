export async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const total = items.length
  if (total === 0) {
    return
  }

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), total))
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1

        if (index >= total) {
          return
        }

        const item = items[index]
        if (item === undefined) {
          return
        }

        await worker(item, index)
      }
    }),
  )
}
