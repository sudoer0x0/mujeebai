// PPTX slide and speaker notes text extraction.
function extractTextNodes(xml: string): string {
  const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)];
  return matches.map((m) => m[1]).join(" ");
}

const MAX_TOTAL_UNCOMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_SLIDES = 100;

export async function processPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    })
    .slice(0, MAX_SLIDES);

  let totalUncompressedBytes = 0;
  const sections: string[] = [];

  for (const [index, file] of slideFiles.entries()) {
    const xml = await zip.files[file].async("string");
    totalUncompressedBytes += xml.length;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      sections.push("*(Document truncated: maximum slide content size exceeded)*");
      break;
    }

    const text = extractTextNodes(xml).trim();
    if (text) sections.push(`## Slide ${index + 1}\n${text}`);

    const notesFile = `ppt/notesSlides/notesSlide${index + 1}.xml`;
    if (zip.files[notesFile]) {
      const notesXml = await zip.files[notesFile].async("string");
      totalUncompressedBytes += notesXml.length;
      const notesText = extractTextNodes(notesXml).trim();
      if (notesText) sections.push(`(Speaker notes: ${notesText})`);
    }
  }

  return sections.join("\n\n").slice(0, 200_000) || "(no extractable text)";
}
