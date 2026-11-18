import type { ChildChunk, ExtractedDocument, ParentChunk } from "./types.ts";

export interface ChunkingConfig {
  maxParentChars?: number;
  targetChildChars?: number;
  maxChildChars?: number;
  overlapChars?: number;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "he", "her", "here",
  "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "may",
  "might", "more", "most", "must", "no", "not", "of", "on", "or", "other", "our",
  "out", "over", "said", "she", "should", "so", "some", "such", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those", "to",
  "too", "under", "up", "use", "used", "using", "very", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "why", "will", "with", "would", "you", "your",
]);

export function extractKeywords(text: string, maxKeywords = 24): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_+\-*/^=]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const counts = new Map<string, number>();
  for (const tok of tokens) {
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function isProtectedBlock(block: string): boolean {
  const trimmed = block.trim();
  // Keep code blocks, math/equation blocks, and markdown/pipe tables intact where possible
  return (
    trimmed.startsWith("```") ||
    trimmed.includes(" | ") ||
    /\$\$[\s\S]+\$\$/.test(trimmed) ||
    /^(Theorem|Lemma|Definition|Corollary|Formula|Equation)\b/i.test(trimmed)
  );
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  // Split cleanly on sentence boundaries without breaking decimal numbers or abbreviations like "e.g."
  const parts = paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9(\["'])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function buildChildTextsFromSection(
  blocks: Array<{ text: string; pageNumber: number }>,
  targetChildChars: number,
  maxChildChars: number,
  overlapChars: number
): Array<{ text: string; pageNumber: number; pageStart: number; pageEnd: number }> {
  // Expand very large prose paragraphs into sentences while leaving protected blocks (tables/formulas) intact
  const atomicUnits: Array<{ text: string; pageNumber: number }> = [];
  for (const blk of blocks) {
    const t = blk.text.trim();
    if (!t) continue;
    if (t.length <= maxChildChars || isProtectedBlock(t)) {
      atomicUnits.push({ text: t, pageNumber: blk.pageNumber });
    } else {
      const sentences = splitParagraphIntoSentences(t);
      if (sentences.length <= 1) {
        // Fallback clean word-boundary split if a single run-on block is huge
        for (let i = 0; i < t.length; i += targetChildChars) {
          atomicUnits.push({
            text: t.slice(i, i + targetChildChars).trim(),
            pageNumber: blk.pageNumber,
          });
        }
      } else {
        for (const s of sentences) {
          atomicUnits.push({ text: s, pageNumber: blk.pageNumber });
        }
      }
    }
  }

  const chunks: Array<{ text: string; pageNumber: number; pageStart: number; pageEnd: number }> = [];
  let currentUnits: Array<{ text: string; pageNumber: number }> = [];
  let currentLen = 0;

  const flushChunk = () => {
    if (currentUnits.length === 0) return;
    const text = currentUnits.map((u) => u.text).join("\n\n").trim();
    const pageStart = currentUnits[0].pageNumber;
    const pageEnd = currentUnits[currentUnits.length - 1].pageNumber;
    chunks.push({
      text,
      pageNumber: pageStart,
      pageStart,
      pageEnd,
    });

    // Carry trailing units up to overlapChars for smooth semantic continuity
    const overlapUnits: Array<{ text: string; pageNumber: number }> = [];
    let overlapLen = 0;
    for (let i = currentUnits.length - 1; i >= 0; i--) {
      const u = currentUnits[i];
      if (overlapLen + u.text.length > overlapChars && overlapUnits.length > 0) break;
      if (u.text.length > overlapChars * 1.6) break;
      overlapUnits.unshift(u);
      overlapLen += u.text.length;
    }
    currentUnits = overlapUnits;
    currentLen = overlapLen;
  };

  for (const unit of atomicUnits) {
    if (currentUnits.length > 0 && currentLen + unit.text.length + 2 > maxChildChars) {
      flushChunk();
    }
    currentUnits.push(unit);
    currentLen += unit.text.length + 2;
    if (currentLen >= targetChildChars && currentUnits.length >= 2) {
      // Only flush early when we reached a clean paragraph unit and aren't in the middle of a tiny split
      if (unit.text.length >= 120) {
        flushChunk();
      }
    }
  }

  if (currentUnits.length > 0) {
    const remainingText = currentUnits.map((u) => u.text).join("\n\n").trim();
    const lastChunk = chunks[chunks.length - 1];
    // Avoid creating a tiny redundant trailing overlap-only chunk
    if (!lastChunk || !lastChunk.text.endsWith(remainingText)) {
      chunks.push({
        text: remainingText,
        pageNumber: currentUnits[0].pageNumber,
        pageStart: currentUnits[0].pageNumber,
        pageEnd: currentUnits[currentUnits.length - 1].pageNumber,
      });
    }
  }

  return chunks;
}

export function buildHierarchicalChunks(
  extracted: ExtractedDocument,
  meta: {
    userId: string;
    documentId: string;
    contentHash: string;
    fileName: string;
  },
  config: ChunkingConfig = {}
): { parents: ParentChunk[]; children: ChildChunk[] } {
  const maxParentChars = config.maxParentChars ?? 2800;
  const targetChildChars = config.targetChildChars ?? 750;
  const maxChildChars = config.maxChildChars ?? 1000;
  const overlapChars = config.overlapChars ?? 140;

  interface SectionBucket {
    title: string;
    hasExplicitHeading?: boolean;
    headingPageNumber?: number;
    blocks: Array<{ text: string; pageNumber: number }>;
    charCount: number;
  }

  const sections: SectionBucket[] = [];
  let currentSection: SectionBucket = {
    title: meta.fileName.replace(/\.[^.]+$/, "") || "Overview",
    hasExplicitHeading: false,
    blocks: [],
    charCount: 0,
  };

  for (const page of extracted.pages) {
    const paragraphs = page.text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    for (const para of paragraphs) {
      const isHeading = para.startsWith("## ") || /^#{1,4}\s+/.test(para);
      if (isHeading) {
        const headingTitle = para.replace(/^#{1,4}\s+/, "").trim();
        if (currentSection.blocks.length > 0) {
          sections.push(currentSection);
        } else if (currentSection.hasExplicitHeading && currentSection.title) {
          currentSection.blocks.push({
            text: currentSection.title,
            pageNumber: currentSection.headingPageNumber ?? page.pageNumber,
          });
          sections.push(currentSection);
        }
        currentSection = {
          title: headingTitle || currentSection.title,
          hasExplicitHeading: true,
          headingPageNumber: page.pageNumber,
          blocks: [],
          charCount: 0,
        };
      } else {
        // Split very long sections cleanly into consecutive section parts so parent chunks stay bounded
        if (currentSection.charCount + para.length > maxParentChars && currentSection.blocks.length > 0) {
          const baseTitle = currentSection.title;
          sections.push(currentSection);
          currentSection = {
            title: baseTitle,
            hasExplicitHeading: true,
            headingPageNumber: page.pageNumber,
            blocks: [],
            charCount: 0,
          };
        }
        currentSection.blocks.push({ text: para, pageNumber: page.pageNumber });
        currentSection.charCount += para.length;
      }
    }
  }

  if (currentSection.blocks.length > 0 || currentSection.hasExplicitHeading || sections.length === 0) {
    if (currentSection.blocks.length === 0) {
      currentSection.blocks.push({
        text: currentSection.hasExplicitHeading ? currentSection.title : `Document: ${meta.fileName}`,
        pageNumber: currentSection.headingPageNumber ?? 1,
      });
    }
    sections.push(currentSection);
  }

  const parents: ParentChunk[] = [];
  const children: ChildChunk[] = [];
  let globalChildIndex = 0;

  sections.forEach((sec, pIdx) => {
    const parentId = `p_${pIdx}`;
    const pageStart = sec.blocks[0].pageNumber;
    const pageEnd = sec.blocks[sec.blocks.length - 1].pageNumber;
    const fullText = sec.blocks.map((b) => b.text).join("\n\n").trim();
    const summary = fullText.slice(0, 320).replace(/\s+/g, " ").trim();

    parents.push({
      id: parentId,
      documentId: meta.documentId,
      userId: meta.userId,
      contentHash: meta.contentHash,
      sectionTitle: sec.title,
      pageStart,
      pageEnd,
      orderIndex: pIdx,
      summary,
      text: fullText,
      tokenEstimate: estimateTokens(fullText),
    });

    const childSegments = buildChildTextsFromSection(
      sec.blocks,
      targetChildChars,
      maxChildChars,
      overlapChars
    );

    for (const seg of childSegments) {
      const chunkId = `c_${globalChildIndex}`;
      children.push({
        id: chunkId,
        parentId,
        documentId: meta.documentId,
        userId: meta.userId,
        contentHash: meta.contentHash,
        sectionTitle: sec.title,
        pageNumber: seg.pageNumber,
        pageStart: seg.pageStart,
        pageEnd: seg.pageEnd,
        chunkIndex: globalChildIndex,
        text: seg.text,
        tokenEstimate: estimateTokens(seg.text),
        keywords: extractKeywords(`${sec.title} ${seg.text}`),
      });
      globalChildIndex++;
    }
  });

  return { parents, children };
}
