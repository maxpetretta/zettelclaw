export function substituteTemplate(template: string, values: Record<string, string>): string {
  let output = template

  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value)
  }

  return output
}
