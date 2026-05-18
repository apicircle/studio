// Minimal className combiner — concatenates truthy strings with a space.
// Avoids pulling in clsx for one helper.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
