import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import JSZip from "jszip";
import type { ExtractedDocument, ExtractedLine, ExtractedPage } from "./types.ts";

interface TextSpan {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

const HEADING_PATTERN =
  /^(chapter\s+\d+|section\s+\d+(\.\d+)*|part\s+[ivx\d]+|\d+(\.\d+){0,3}\s+[A-Z][\w\s,:-]{2,}|appendix\s+[a-z\d]+|#{1,4}\s+.+)/i;

function normalizeSpaces(input: string): string {
  return input.replace(/[\u00A0\t]+/g, " ").replace(/[ ]{2,}/g, " ").trim();
}

function cleanPageNumberLine(line: string): boolean {
  const t = line.trim();
  return (
    /^page\s+\d+(\s+of\s+\d+)?$/i.test(t) ||
    /^\d{1,4}$/.test(t) ||
    /^-\s*\d{1,4}\s*-$/.test(t)
  );
}

function isLikelyHeading(text: string, fontSize: number, medianFontSize: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 110) return false;
  if (cleanPageNumberLine(trimmed)) return false;
  if (/[.?!]$/.test(trimmed) && trimmed.split(/\s+/).length > 8) return false;

  if (HEADING_PATTERN.test(trimmed)) return true;

  const isSignificantlyLarger = medianFontSize > 0 && fontSize >= medianFontSize * 1.18;
  const wordCount = trimmed.split(/\s+/).length;
  if (isSignificantlyLarger && wordCount <= 14) return true;

  // Short ALL-CAPS titles (ignoring purely numeric/formula lines)
  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  if (
    letters.length >= 4 &&
    letters.length <= 60 &&
    letters === letters.toUpperCase() &&
    wordCount <= 10
  ) {
    return true;
  }

  return false;
}

function reconstructLinesFromItems(items: any[]): Array<{ text: string; fontSize: number }> {
  const spans: TextSpan[] = [];
  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const str = item.str;
    if (!str.trim() && !item.hasEOL) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [12, 0, 0, 12, 0, 0];
    const fontSize = Math.abs(transform[3]) || Math.abs(transform[0]) || item.height || 12;
    spans.push({
      str,
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Number(item.width) || 0,
      fontSize,
    });
  }

  if (spans.length === 0) return [];

  // Sort top-to-bottom (higher Y first in PDF coordinates), then left-to-right (lower X)
  spans.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > Math.max(3, Math.min(a.fontSize, b.fontSize) * 0.45)) {
      return yDiff;
    }
    return a.x - b.x;
  });

  const rows: Array<{ y: number; spans: TextSpan[] }> = [];
  for (const span of spans) {
    const tol = Math.max(3, span.fontSize * 0.45);
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow.y - span.y) <= tol) {
      lastRow.spans.push(span);
    } else {
      rows.push({ y: span.y, spans: [span] });
    }
  }

  const lines: Array<{ text: string; fontSize: number }> = [];
  for (const row of rows) {
    row.spans.sort((a, b) => a.x - b.x);
    let lineText = "";
    let prevEnd = -Infinity;
    let weightedFontSum = 0;
    let charCount = 0;

    for (const s of row.spans) {
      const piece = s.str;
      if (!piece) continue;
      if (prevEnd > -Infinity) {
        const gap = s.x - prevEnd;
        // Preserve column spacing for tables when gap is notably wider than a normal space
        if (gap > s.fontSize * 1.4 && !lineText.endsWith(" ")) {
          lineText += " | ";
        } else if (
          gap > s.fontSize * 0.18 &&
          !lineText.endsWith(" ") &&
          !piece.startsWith(" ")
        ) {
          lineText += " ";
        }
      }
      lineText += piece;
      prevEnd = s.x + Math.max(s.width, piece.length * s.fontSize * 0.45);
      weightedFontSum += s.fontSize * piece.trim().length;
      charCount += piece.trim().length;
    }

    const cleaned = normalizeSpaces(lineText);
    if (cleaned) {
      lines.push({
        text: cleaned,
        fontSize: charCount > 0 ? weightedFontSum / charCount : 12,
      });
    }
  }

  return lines;
}

export async function extractPdfDocument(
  pdfBytes: Uint8Array,
  onPageProgress?: (done: number, total: number) => void
): Promise<ExtractedDocument> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  const rawPages: Array<{ pageNumber: number; lines: Array<{ text: string; fontSize: number }> }> =
    [];
  const allFontSizes: number[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const lines = reconstructLinesFromItems(textContent.items as any[]);
        for (const l of lines) {
          if (l.text.length >= 10) {
            allFontSizes.push(l.fontSize);
          }
        }
        rawPages.push({ pageNumber, lines });
      } finally {
        try {
          page.cleanup();
        } catch {
          // ignore
        }
      }

      if (onPageProgress && (pageNumber % 5 === 0 || pageNumber === numPages)) {
        onPageProgress(pageNumber, numPages);
      }
    }
  } finally {
    try {
      await doc.cleanup();
    } catch {
      // ignore
    }
    try {
      await loadingTask.destroy();
    } catch {
      // ignore
    }
  }

  // Median body font size for heading detection
  allFontSizes.sort((a, b) => a - b);
  const medianFontSize =
    allFontSizes.length > 0 ? allFontSizes[Math.floor(allFontSizes.length / 2)] : 12;

  // Detect repeated headers & footers across pages (only meaningful when >= 4 pages)
  const topLineFreq = new Map<string, number>();
  const bottomLineFreq = new Map<string, number>();
  if (numPages >= 4) {
    for (const p of rawPages) {
      if (p.lines.length > 0) {
        const first = p.lines[0].text.replace(/\d+/g, "#").toLowerCase();
        topLineFreq.set(first, (topLineFreq.get(first) || 0) + 1);
      }
      if (p.lines.length > 1) {
        const last = p.lines[p.lines.length - 1].text.replace(/\d+/g, "#").toLowerCase();
        bottomLineFreq.set(last, (bottomLineFreq.get(last) || 0) + 1);
      }
    }
  }

  const threshold = Math.max(3, Math.floor(numPages * 0.4));
  const pages: ExtractedPage[] = [];
  const detectedHeadings: Array<{ title: string; pageNumber: number }> = [];
  let totalChars = 0;

  for (const p of rawPages) {
    let filtered = p.lines.slice();

    if (numPages >= 4 && filtered.length > 2) {
      const topSig = filtered[0].text.replace(/\d+/g, "#").toLowerCase();
      if ((topLineFreq.get(topSig) || 0) >= threshold || cleanPageNumberLine(filtered[0].text)) {
        filtered.shift();
      }
    }
    if (numPages >= 4 && filtered.length > 1) {
      const botSig = filtered[filtered.length - 1].text.replace(/\d+/g, "#").toLowerCase();
      if (
        (bottomLineFreq.get(botSig) || 0) >= threshold ||
        cleanPageNumberLine(filtered[filtered.length - 1].text)
      ) {
        filtered.pop();
      }
    }

    const enrichedLines: ExtractedLine[] = [];
    const joinedParagraphs: string[] = [];
    let currentParagraph = "";

    for (const line of filtered) {
      if (cleanPageNumberLine(line.text)) continue;
      const isHeading = isLikelyHeading(line.text, line.fontSize, medianFontSize);
      enrichedLines.push({
        text: line.text,
        fontSize: line.fontSize,
        isHeadingCandidate: isHeading,
      });

      if (isHeading) {
        if (currentParagraph.trim()) {
          joinedParagraphs.push(currentParagraph.trim());
          currentParagraph = "";
        }
        joinedParagraphs.push(`## ${line.text}`);
        detectedHeadings.push({ title: line.text, pageNumber: p.pageNumber });
      } else {
        // Rejoin hyphenated line breaks cleanly
        if (currentParagraph.endsWith("-") && /^[a-z]/.test(line.text)) {
          currentParagraph = currentParagraph.slice(0, -1) + line.text;
        } else if (
          currentParagraph &&
          (/[.!?:]$/.test(currentParagraph) || line.text.includes(" | ") || currentParagraph.includes(" | "))
        ) {
          joinedParagraphs.push(currentParagraph.trim());
          currentParagraph = line.text;
        } else {
          currentParagraph = currentParagraph ? `${currentParagraph} ${line.text}` : line.text;
        }
      }
    }

    if (currentParagraph.trim()) {
      joinedParagraphs.push(currentParagraph.trim());
    }

    const pageText = joinedParagraphs.join("\n\n").trim();
    totalChars += pageText.length;
    pages.push({
      pageNumber: p.pageNumber,
      text: pageText,
      lines: enrichedLines,
    });
  }

  return {
    pages,
    pageCount: numPages,
    totalChars,
    detectedHeadings,
  };
}

export function extractTextDocument(rawText: string, fileName: string): ExtractedDocument {
  const cleaned = rawText
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Split by explicit form-feed page breaks if present, else virtual pages (~2800 chars at paragraph breaks)
  const rawSegments = cleaned.includes("\f")
    ? cleaned.split("\f").map((s) => s.trim()).filter(Boolean)
    : (() => {
        const paragraphs = cleaned.split(/\n\n+/);
        const virtualPages: string[] = [];
        let acc = "";
        for (const para of paragraphs) {
          if (acc.length + para.length > 2800 && acc.length > 0) {
            virtualPages.push(acc.trim());
            acc = para;
          } else {
            acc = acc ? `${acc}\n\n${para}` : para;
          }
        }
        if (acc.trim()) virtualPages.push(acc.trim());
        return virtualPages.length > 0 ? virtualPages : [cleaned || fileName];
      })();

  const pages: ExtractedPage[] = [];
  const detectedHeadings: Array<{ title: string; pageNumber: number }> = [];
  let totalChars = 0;

  rawSegments.forEach((segment, idx) => {
    const pageNumber = idx + 1;
    const rawLines = segment.split("\n");
    const lines: ExtractedLine[] = [];

    for (const rawLine of rawLines) {
      const t = rawLine.trim();
      if (!t) continue;
      const isMdHeading = /^#{1,4}\s+/.test(t);
      const isTitleHeading = isMdHeading || isLikelyHeading(t, 14, 12);
      const normalizedTitle = t.replace(/^#{1,4}\s+/, "").trim();
      lines.push({
        text: normalizedTitle,
        fontSize: isTitleHeading ? 15 : 12,
        isHeadingCandidate: isTitleHeading,
      });
      if (isTitleHeading) {
        detectedHeadings.push({ title: normalizedTitle, pageNumber });
      }
    }

    totalChars += segment.length;
    pages.push({
      pageNumber,
      text: segment,
      lines,
    });
  });

  return {
    pages,
    pageCount: pages.length,
    totalChars,
    detectedHeadings,
  };
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function extractParagraphsFromXmlFragment(xml: string): string[] {
  const paragraphs: string[] = [];
  const pMatches = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) || [];
  for (const pXml of pMatches) {
    const runs: string[] = [];
    const tokenRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>|<a:tab\b[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(pXml)) !== null) {
      if (m[1] !== undefined) {
        runs.push(decodeXmlEntities(m[1]));
      } else if (m[0].startsWith("<a:tab")) {
        runs.push(" ");
      } else {
        runs.push("\n");
      }
    }
    const line = normalizeSpaces(runs.join(""));
    if (line) paragraphs.push(line);
  }
  return paragraphs;
}

function extractSlideContentFromXml(slideXml: string): {
  title: string | null;
  bodyLines: string[];
  tableLines: string[];
} {
  let title: string | null = null;
  const bodyLines: string[] = [];
  const tableLines: string[] = [];

  // 1. Extract tables (<a:tbl>) preserving multi-column structure with " | "
  const tblMatches = slideXml.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/g) || [];
  let xmlWithoutTables = slideXml;
  for (const tblXml of tblMatches) {
    xmlWithoutTables = xmlWithoutTables.replace(tblXml, "");
    const rowMatches = tblXml.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || [];
    for (const rowXml of rowMatches) {
      const cellMatches = rowXml.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || [];
      const rowCells = cellMatches.map((cellXml) =>
        extractParagraphsFromXmlFragment(cellXml).join(" ")
      );
      const cleanRow = rowCells.map((c) => normalizeSpaces(c)).filter(Boolean);
      if (cleanRow.length > 0) {
        tableLines.push(cleanRow.join(" | "));
      }
    }
  }

  // 2. Extract shapes (<p:sp>) distinguishing title placeholders from body shapes
  const spMatches = xmlWithoutTables.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || [];
  let consumedXml = xmlWithoutTables;
  for (const spXml of spMatches) {
    consumedXml = consumedXml.replace(spXml, "");
    const isTitleShape =
      /<p:ph[^>]*\btype=["'](?:title|ctrTitle)["']/i.test(spXml);
    const isSubTitle = /<p:ph[^>]*\btype=["']subTitle["']/i.test(spXml);
    const paras = extractParagraphsFromXmlFragment(spXml);
    if (paras.length === 0) continue;

    if (isTitleShape && !title) {
      title = paras.join(" ");
    } else if (isSubTitle && !title) {
      title = paras.join(" ");
    } else {
      bodyLines.push(...paras);
    }
  }

  // 3. Catch any grouped/diagram shapes (<p:grpSp> or leftover <a:p>) outside top-level <p:sp>
  if (consumedXml.includes("<a:t")) {
    const remainingParas = extractParagraphsFromXmlFragment(consumedXml);
    bodyLines.push(...remainingParas);
  }

  return { title, bodyLines, tableLines };
}

function getOrderedPptxSlidePaths(zip: JSZip, presentationXml?: string, relsXml?: string): string[] {
  const allSlideFiles = Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/i.test(p)
  );
  const numericFallback = [...allSlideFiles].sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
    const nb = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
    return na - nb;
  });

  if (!presentationXml || !relsXml) {
    return numericFallback;
  }

  // Map rId -> target path from presentation.xml.rels
  const relMap = new Map<string, string>();
  const relRegex = /<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["'][^>]*>/gi;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    const id = relMatch[1];
    let target = relMatch[2].replace(/^\/+/, "");
    if (!target.startsWith("ppt/")) {
      target = `ppt/${target}`;
    }
    relMap.set(id, target);
  }

  const ordered: string[] = [];
  const sldIdRegex = /<p:sldId\b[^>]*\br:id=["']([^"']+)["'][^>]*\/?>/gi;
  let sldMatch: RegExpExecArray | null;
  while ((sldMatch = sldIdRegex.exec(presentationXml)) !== null) {
    const resolved = relMap.get(sldMatch[1]);
    if (resolved && zip.files[resolved] && !ordered.includes(resolved)) {
      ordered.push(resolved);
    }
  }

  for (const extra of numericFallback) {
    if (!ordered.includes(extra)) ordered.push(extra);
  }
  return ordered;
}

export async function extractPptxDocument(
  pptBytes: Uint8Array,
  fileName: string,
  onSlideProgress?: (done: number, total: number) => void
): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(pptBytes);

  const presXml = await zip.file("ppt/presentation.xml")?.async("text");
  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("text");
  const slidePaths = getOrderedPptxSlidePaths(zip, presXml, presRelsXml);

  if (slidePaths.length === 0) {
    throw new Error("No slides found inside the uploaded .pptx presentation.");
  }

  const rawSlides: Array<{
    slideNumber: number;
    title: string | null;
    lines: string[];
    notes: string[];
  }> = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideNumber = i + 1;
    const slideXml = (await zip.file(slidePath)?.async("text")) || "";
    const parsed = extractSlideContentFromXml(slideXml);

    // Check linked speaker notes slide via ppt/slides/_rels/slideN.xml.rels
    const notes: string[] = [];
    const slideBase = slidePath.split("/").pop() || "";
    const slideRelsPath = `ppt/slides/_rels/${slideBase}.rels`;
    const slideRelsXml = await zip.file(slideRelsPath)?.async("text");
    if (slideRelsXml) {
      const noteTargetMatch = slideRelsXml.match(
        /<Relationship\b[^>]*notesSlide[^>]*\bTarget=["']([^"']+)["']/i
      ) || slideRelsXml.match(
        /<Relationship\b[^>]*\bTarget=["']([^"']*notesSlides\/[^"']+)["']/i
      );
      if (noteTargetMatch) {
        let notePath = noteTargetMatch[1].replace(/^\.\.\//, "ppt/").replace(/^\/+/, "");
        if (!notePath.startsWith("ppt/")) {
          notePath = `ppt/slides/${notePath}`;
        }
        const notesXml = await zip.file(notePath)?.async("text");
        if (notesXml) {
          const noteParas = extractParagraphsFromXmlFragment(notesXml).filter(
            (n) => !cleanPageNumberLine(n)
          );
          notes.push(...noteParas);
        }
      }
    }

    const combinedLines = [...parsed.bodyLines, ...parsed.tableLines];
    // If slide has no explicit title placeholder, promote short first line if heading-like
    let effectiveTitle = parsed.title;
    if (!effectiveTitle && combinedLines.length > 0 && combinedLines[0].length <= 95) {
      effectiveTitle = combinedLines.shift()!;
    }

    rawSlides.push({
      slideNumber,
      title: effectiveTitle,
      lines: combinedLines,
      notes,
    });

    if (onSlideProgress && (slideNumber % 5 === 0 || slideNumber === slidePaths.length)) {
      onSlideProgress(slideNumber, slidePaths.length);
    }
  }

  // Strip repeated slide footers/watermarks appearing across >= 40% of slides
  const repeatedLineFreq = new Map<string, number>();
  for (const s of rawSlides) {
    const uniqueOnSlide = new Set(s.lines.map((l) => l.toLowerCase()));
    for (const key of uniqueOnSlide) {
      if (key.length <= 120) {
        repeatedLineFreq.set(key, (repeatedLineFreq.get(key) || 0) + 1);
      }
    }
  }
  const freqThreshold = rawSlides.length >= 4 ? Math.ceil(rawSlides.length * 0.4) : Infinity;

  const pages: ExtractedPage[] = [];
  const detectedHeadings: Array<{ title: string; pageNumber: number }> = [];
  let totalChars = 0;

  for (const s of rawSlides) {
    const filteredLines = s.lines.filter(
      (l) => !cleanPageNumberLine(l) && (repeatedLineFreq.get(l.toLowerCase()) || 0) < freqThreshold
    );

    const headingTitle = s.title || `Slide ${s.slideNumber}`;
    detectedHeadings.push({ title: headingTitle, pageNumber: s.slideNumber });

    const enrichedLines: ExtractedLine[] = [
      {
        text: headingTitle,
        fontSize: 18,
        isHeadingCandidate: true,
      },
      ...filteredLines.map((text) => ({
        text,
        fontSize: 12,
        isHeadingCandidate: false,
      })),
    ];

    const parts: string[] = [`## ${headingTitle}`];
    if (filteredLines.length > 0) {
      parts.push(filteredLines.join("\n"));
    } else if (s.notes.length === 0 && s.title) {
      // Title-only slide (e.g. cover/divider slide): keep title as searchable body content
      parts.push(s.title);
    }
    if (s.notes.length > 0) {
      parts.push(`Speaker Notes: ${s.notes.join(" ")}`);
      for (const note of s.notes) {
        enrichedLines.push({
          text: note,
          fontSize: 11,
          isHeadingCandidate: false,
        });
      }
    }

    const slideText = parts.join("\n\n").trim() || `${fileName} — Slide ${s.slideNumber}`;
    totalChars += slideText.length;
    pages.push({
      pageNumber: s.slideNumber,
      text: slideText,
      lines: enrichedLines,
    });
  }

  return {
    pages,
    pageCount: pages.length,
    totalChars,
    detectedHeadings,
  };
}

/**
 * Extracts text from legacy binary Microsoft PowerPoint (.ppt OLE2 Compound Document).
 * Reassembles the fragmented 'PowerPoint Document' stream via OLE2 FAT chains,
 * then walks PPT binary container/atom records (Slide 0x03EE, TextCharsAtom 0x0FA0, TextBytesAtom 0x0FA8).
 */
function readOle2Stream(fileBytes: Uint8Array, targetStreamName: string): Uint8Array | null {
  const buf = Buffer.from(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  if (buf.length < 512) return null;
  // OLE2 magic: D0 CF 11 E0 A1 B1 1A E1
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== magic[i]) return null;
  }

  const sectorShift = buf.readUInt16LE(30);
  const sectorSize = 1 << sectorShift;
  if (sectorSize < 512 || sectorSize > 4096) return null;

  const firstDirSector = buf.readInt32LE(48);
  const readSector = (secId: number): Buffer => {
    const offset = (secId + 1) * sectorSize;
    if (offset < 0 || offset + sectorSize > buf.length) {
      return Buffer.alloc(0);
    }
    return buf.subarray(offset, offset + sectorSize);
  };

  // Build FAT table from DIFAT (first 109 entries inside header at offset 76)
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sec = buf.readInt32LE(76 + i * 4);
    if (sec >= 0) fatSectors.push(sec);
  }
  const fat: number[] = [];
  for (const fatSec of fatSectors) {
    const secBuf = readSector(fatSec);
    for (let j = 0; j + 4 <= secBuf.length; j += 4) {
      fat.push(secBuf.readInt32LE(j));
    }
  }

  const followChain = (startSec: number, expectedLen?: number): Buffer => {
    const chunks: Buffer[] = [];
    const seen = new Set<number>();
    let cur = startSec;
    while (cur >= 0 && !seen.has(cur) && chunks.length < 200000) {
      seen.add(cur);
      const secBuf = readSector(cur);
      if (secBuf.length === 0) break;
      chunks.push(secBuf);
      cur = cur < fat.length ? fat[cur] : -2;
    }
    const full = Buffer.concat(chunks);
    return typeof expectedLen === "number" && expectedLen > 0
      ? full.subarray(0, expectedLen)
      : full;
  };

  const dirStream = followChain(firstDirSector);
  for (let off = 0; off + 128 <= dirStream.length; off += 128) {
    const nameByteLen = dirStream.readUInt16LE(off + 64);
    const clampedLen = Math.max(0, Math.min(64, nameByteLen - 2));
    const entryName = dirStream.subarray(off, off + clampedLen).toString("utf16le");
    if (entryName === targetStreamName) {
      const startSec = dirStream.readInt32LE(off + 116);
      const streamSize = dirStream.readUInt32LE(off + 120);
      return new Uint8Array(followChain(startSec, streamSize));
    }
  }
  return null;
}

export function extractPptBinaryDocument(pptBytes: Uint8Array, fileName: string): ExtractedDocument {
  const pptStream = readOle2Stream(pptBytes, "PowerPoint Document");
  const source = pptStream
    ? Buffer.from(pptStream.buffer, pptStream.byteOffset, pptStream.byteLength)
    : Buffer.from(pptBytes.buffer, pptBytes.byteOffset, pptBytes.byteLength);

  const slidesText: string[][] = [];
  let currentSlideLines: string[] = [];

  const flushSlide = () => {
    if (currentSlideLines.length > 0) {
      slidesText.push(currentSlideLines);
      currentSlideLines = [];
    }
  };

  const walkRecords = (start: number, end: number, depth = 0) => {
    if (depth > 16) return;
    let offset = start;
    while (offset + 8 <= end) {
      const verAndInst = source.readUInt16LE(offset);
      const recVer = verAndInst & 0x0f;
      const recType = source.readUInt16LE(offset + 2);
      const recLen = source.readUInt32LE(offset + 4);
      const bodyStart = offset + 8;
      const bodyEnd = bodyStart + recLen;
      if (recLen < 0 || bodyEnd > end) break;

      if (recType === 0x03ee || recType === 0x0ff0 || recType === 0x03f3) {
        // Slide (0x03EE), SlideListWithText (0x0FF0), or SlidePersistAtom (0x03F3)
        flushSlide();
      }

      if (recVer === 0x0f) {
        // Container record: recurse into children
        walkRecords(bodyStart, bodyEnd, depth + 1);
      } else if (recType === 0x0fa0 && recLen >= 2) {
        // TextCharsAtom (UTF-16LE)
        const text = source
          .subarray(bodyStart, bodyEnd)
          .toString("utf16le")
          .replace(/[\r\x0b]/g, "\n")
          .split("\n")
          .map((l) => normalizeSpaces(l))
          .filter(Boolean);
        currentSlideLines.push(...text);
      } else if (recType === 0x0fa8 && recLen >= 1) {
        // TextBytesAtom (Latin-1 / CP1252)
        const text = source
          .subarray(bodyStart, bodyEnd)
          .toString("latin1")
          .replace(/[\r\x0b]/g, "\n")
          .split("\n")
          .map((l) => normalizeSpaces(l))
          .filter(Boolean);
        currentSlideLines.push(...text);
      }

      offset = bodyEnd;
    }
  };

  walkRecords(0, source.length);
  flushSlide();

  if (slidesText.length === 0) {
    throw new Error(
      `Could not extract text from legacy PowerPoint file "${fileName}". It may be password-protected or image-only—please export as .pptx or .pdf.`
    );
  }

  const pages: ExtractedPage[] = [];
  const detectedHeadings: Array<{ title: string; pageNumber: number }> = [];
  let totalChars = 0;

  slidesText.forEach((rawLines, idx) => {
    const slideNumber = idx + 1;
    const filtered = rawLines.filter((l) => !cleanPageNumberLine(l));
    if (filtered.length === 0) return;

    const pageNum = pages.length + 1;
    const title = filtered[0].length <= 100 ? filtered[0] : `Slide ${pageNum}`;
    const body = filtered[0] === title ? filtered.slice(1) : filtered;
    const effectiveBody = body.length > 0 ? body : [filtered[0]];
    detectedHeadings.push({ title, pageNumber: pageNum });

    const enrichedLines: ExtractedLine[] = [
      { text: title, fontSize: 18, isHeadingCandidate: true },
      ...effectiveBody.map((t) => ({ text: t, fontSize: 12, isHeadingCandidate: false })),
    ];

    const slideText = [`## ${title}`, effectiveBody.join("\n")].filter(Boolean).join("\n\n").trim();
    totalChars += slideText.length;
    pages.push({
      pageNumber: pageNum,
      text: slideText,
      lines: enrichedLines,
    });
  });

  if (pages.length === 0) {
    throw new Error(
      `No readable text slides found inside "${fileName}". Please try saving as .pptx or .pdf.`
    );
  }

  return {
    pages,
    pageCount: pages.length,
    totalChars,
    detectedHeadings,
  };
}

