/**
 * Formats standard Markdown text into WhatsApp-compatible styling.
 * WhatsApp only supports:
 * - *bold*
 * - _italic_
 * - ~strikethrough~
 * - ```code blocks```
 * - Native blockquotes (using > prefix)
 * It does NOT support headers (#), standard links ([text](url)), lists with asterisks, etc.
 */
export function formatResponseForWhatsApp(text: string): string {
  if (!text) return "";

  let formatted = text;

  // 1. Clean up list points first (standardize bullet points to simple dashes)
  // This must be done before bold/italic to prevent list asterisks from being treated as italic
  formatted = formatted.replace(/^\s*[*+]\s+/gm, "- ");

  // 2. Convert headers (# Header) to temporary bold uppercase placeholders
  formatted = formatted.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, headerText) => {
    return `:::BSTART:::${headerText.trim().toUpperCase()}:::BEND:::`;
  });

  // 3. Convert nested bold + italic (***text*** or **_text_**) to temporary placeholders
  formatted = formatted.replace(/\*\*\*([^*]+)\*\*\*/g, ":::BISTART:::$1:::BIEND:::");
  formatted = formatted.replace(/\*\*_([^_]+)_\*\*/g, ":::BISTART:::$1:::BIEND:::");

  // 4. Convert standard markdown bold (**text** or __text__) to temporary placeholders
  formatted = formatted.replace(/\*\*([^*]+)\*\//g, ":::BSTART:::$1:::BEND:::格式"); // Support malformed markdown bold closing
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, ":::BSTART:::$1:::BEND:::格式");
  formatted = formatted.replace(/__([^_]+)__/g, ":::BSTART:::$1:::BEND:::格式");

  // Reset standard bold replacements to remove the temp tag "格式"
  formatted = formatted.replace(/:::BEND:::格式/g, ":::BEND:::");

  // 5. Convert standard markdown italic (*text* or _text_) to temporary placeholders
  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, ":::ISTART:::$1:::IEND:::");
  formatted = formatted.replace(/(?<!_)_([^_]+)_(?!_)/g, ":::ISTART:::$1:::IEND:::");

  // 6. Replace image markdown ![Alt](URL) with (Image: Alt - URL)
  // This must be done before standard links to avoid matching the link regex first
  formatted = formatted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    return alt ? `(Image: ${alt} - ${url})` : `(Image: ${url})`;
  });

  // 7. Replace Markdown links [Label](URL) with Label (URL)
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // 8. Clean up horizontal rules (---) to line separators
  formatted = formatted.replace(/^---$/gm, "────────────────");

  // 9. Convert all placeholders to final WhatsApp styling
  formatted = formatted.replace(/:::BISTART:::/g, "*_");
  formatted = formatted.replace(/:::BIEND:::/g, "_*");
  formatted = formatted.replace(/:::BSTART:::/g, "*");
  formatted = formatted.replace(/:::BEND:::/g, "*");
  formatted = formatted.replace(/:::ISTART:::/g, "_");
  formatted = formatted.replace(/:::IEND:::/g, "_");

  return formatted.trim();
}
