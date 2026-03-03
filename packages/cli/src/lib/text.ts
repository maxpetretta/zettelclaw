export function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      continue
    }

    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    output.push(trimmed)
  }

  return output
}
