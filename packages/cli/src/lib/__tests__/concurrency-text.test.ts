import { describe, expect, it } from "bun:test"

import { forEachConcurrent } from "../concurrency"
import { uniqueTrimmedStrings } from "../text"

describe("forEachConcurrent", () => {
  it("returns immediately for empty lists", async () => {
    let called = false
    await forEachConcurrent([], 4, () => {
      called = true
      return Promise.resolve()
    })

    expect(called).toBe(false)
  })

  it("processes all items with bounded worker count", async () => {
    const seen: number[] = []

    await forEachConcurrent([1, 2, 3, 4, 5], 20, async (item) => {
      await Bun.sleep(item % 2 === 0 ? 2 : 1)
      seen.push(item)
    })

    expect(seen.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5])
  })
})

describe("uniqueTrimmedStrings", () => {
  it("deduplicates case-insensitively and strips empty values", () => {
    const unique = uniqueTrimmedStrings([" Alpha ", "alpha", "BETA", " beta ", "", "  ", "Gamma"])
    expect(unique).toEqual(["Alpha", "BETA", "Gamma"])
  })
})
