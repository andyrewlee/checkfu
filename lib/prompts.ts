import { letterSize } from "@/lib/image/pageMetrics";
import type { Page, TextChild, ImageChild } from "@/store/useEditorStore";

export function computeSystemPrompt(
  p: Page,
  standardsCatalog: { code: string; description: string }[],
): string {
  const isWorksheet = (p.pageType || "coloring") === "worksheet";
  const { w, h } = letterSize(p.orientation);
  const letter = `${w}×${h} ${p.orientation}`;
  const printRules = [
    `Print target: US Letter ${letter}.`,
    "Output: one black and white line art image for print.",
    "Style: thick uniform outlines, high contrast, large closed shapes. No gray tones. No shading. No halftones. No photo textures.",
    "Background: white only.",
    "Exclusions: no frames, borders, watermarks, signatures, logos, or captions.",
    "Aspect: do not change the provided orientation.",
    "If a mask is provided, change only masked regions and keep all unmasked regions identical.",
  ].join(" ");
  if (isWorksheet) {
    const selected = p.standards || [];
    const codes = selected.join(", ");
    const lookup = new Map(
      standardsCatalog.map((s) => [s.code, s.description] as const),
    );
    const descs = selected
      .map((code) => {
        const d = lookup.get(code) || "";
        return d ? `${code}: ${d}` : "";
      })
      .filter(Boolean);
    const ccSummary = codes
      ? `Common Core Kindergarten focus: ${codes}. `
      : "Common Core Kindergarten math practices. ";
    const ccDetail = descs.length
      ? `Target standards: ${descs.join("; ")}. `
      : "";
    const wk = [
      "Purpose: a solvable worksheet that a kindergarten student can complete independently.",
      "1) Provide exactly one short instruction line at the top in simple English.",
      "2) Use concrete visual math tools such as ten frames, number lines, dot cards, or simple manipulatives.",
      "3) Quantities never exceed 10. Prefer numerals for labels and examples.",
      "4) Use three to six tasks or one main task with three to six parts.",
      "5) Provide large answer areas about 1.25 inch squares or lines with generous white space.",
      "6) Layout flows left to right then top to bottom. Keep balance and clarity.",
      "7) High contrast line art suitable for printing.",
    ].join(" ");
    const wkNegatives = [
      "Do not add titles or headers.",
      "Do not add decorative frames.",
      "",
      "Do not include stickers, emojis, photographs, or gray fills.",
    ].join(" ");
    return `${ccSummary}${ccDetail}${wk} ${printRules} ${wkNegatives}`.trim();
  }
  const styleName = p.coloringStyle || "classic";
  const styleText =
    styleName === "anime"
      ? "Style: anime for children. Clean inked outlines, friendly faces, very large fill areas. No screen tones."
      : styleName === "retro"
        ? "Style: retro nineteen sixty cartoon look. Bold contour lines, simple geometry, playful characters."
        : "Style: classic coloring book. Bold outlines and large closed regions that are easy to color.";
  const col = [
    "Purpose: a kid friendly coloring page with one clear subject and readable shapes.",
    "1) Composition fills the printable area while preserving balanced white space.",
    "2) Use thick outlines and closed shapes to avoid tiny slivers.",
    "3) No text at all.",
    "4) High contrast line art that prints cleanly.",
  ].join(" ");
  const colNegatives = [
    "Do not use gray tones or shading.",
    "Do not use fine hatching or dense patterns.",
    "Do not add borders, titles, captions, watermarks, or logos.",
    "Do not place elements on or past the margins.",
  ].join(" ");
  return `${styleText} ${col} ${printRules} ${colNegatives}`.trim();
}

export function getEffectiveSystemPrompt(
  page: Page,
  catalog: { code: string; description: string }[],
): string {
  return page.systemPromptEdited
    ? (page.systemPrompt ?? "")
    : computeSystemPrompt(page, catalog);
}

export function summarizePageForPrompt(page: Page): string {
  const items = (page.children || []).map((c) => {
    const size = `${Math.round(c.width)}x${Math.round(c.height)}`;
    const pos = `(${Math.round(c.x)}, ${Math.round(c.y)})`;
    if (c.type === "text") {
      const tc = c as TextChild;
      const text = (tc.text || "").slice(0, 80);
      return `Text "${text}" at ${pos} size ${size}${tc.align ? ` align ${tc.align}` : ""}`;
    } else {
      const ic = c as ImageChild;
      return `${ic.src ? "Image" : "Image placeholder"} at ${pos} size ${size}`;
    }
  });
  return items.join("\n");
}

export function buildInstruction(
  page: Page,
  userPrompt: string,
  mode: "page" | "image" | "text" = "page",
  standardsCatalog: { code: string; description: string }[],
): string {
  const user = (userPrompt || "").trim();
  const parts: string[] = [];
  if (mode === "text") {
    parts.push(
      "You are updating a single short text label for a printable page. Return only the label text, no commentary, no markdown.",
    );
    if (user) parts.push(user);
    return parts.join("\n");
  }
  const sys = getEffectiveSystemPrompt(page, standardsCatalog).trim();
  if (mode === "image") {
    const isolation =
      "Treat this as a single image layer. Ignore other layers (text or images) on the page unless explicitly referenced.";
    const optionalText =
      "Include text only if the prompt requests it; otherwise prefer illustration without captions.";
    parts.push(sys);
    parts.push(
      user
        ? `${user}\n${isolation}\n${optionalText}`
        : `${isolation}\n${optionalText}`,
    );
  } else {
    const summary = summarizePageForPrompt(page);
    parts.push(sys);
    if (user) parts.push(user);
    if (summary) parts.push(summary);
  }
  return parts.join("\n");
}
