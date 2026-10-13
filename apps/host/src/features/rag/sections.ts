export type Section = Readonly<{ heading: string; body: string }>;

/** Делит Markdown на разделы по `## `; текст до первого раздела отбрасывается. */
export function splitSections(raw: string): Section[] {
  return raw
    .replaceAll("\r\n", "\n")
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading = "", ...lines] = section.split("\n");
      return { heading: heading.trim(), body: lines.join("\n").trim() };
    });
}

export const bodyOf = (sections: readonly Section[], heading: string): string =>
  sections.find((section) => section.heading === heading)?.body ?? "";
