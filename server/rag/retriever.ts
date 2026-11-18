import { extractKeywords } from "./chunker.ts";
import { embedTextsWithCache } from "./geminiService.ts";
import type { ChildChunk, ParentChunk, RetrievalResult, RetrievedChunkCitation } from "./types.ts";
import {
  getChildChunksWithEmbeddings,
  getParentChunks,
} from "./vectorStore.ts";

export interface RetrieveOptions {
  userId: string;
  documentId: string;
  query: string;
  topK?: number;
  includeAdjacent?: boolean;
  maxContextChars?: number;
}

function cosineSimilarity(
  a: Float32Array,
  aNorm: number,
  b: Float32Array,
  bNorm: number
): number {
  if (aNorm === 0 || bNorm === 0 || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot / (aNorm * bNorm);
}

function computeLexicalScore(queryTokens: string[], chunk: ChildChunk): number {
  if (queryTokens.length === 0) return 0;

  const chunkKeywordSet = new Set(chunk.keywords);
  const lowerText = chunk.text.toLowerCase();
  const lowerSection = chunk.sectionTitle.toLowerCase();

  let hits = 0;
  let sectionHits = 0;

  for (const tok of queryTokens) {
    if (chunkKeywordSet.has(tok) || lowerText.includes(tok)) {
      hits += 1;
    }
    if (lowerSection.includes(tok)) {
      sectionHits += 1;
    }
  }

  const textScore = hits / queryTokens.length;
  const sectionScore = Math.min(1, sectionHits / Math.max(1, Math.min(queryTokens.length, 3)));
  return Math.min(1, 0.72 * textScore + 0.28 * sectionScore);
}

/**
 * Hybrid vector + keyword retrieval strictly isolated by (userId, documentId),
 * with adjacent chunk expansion and parent section metadata.
 */
export async function retrieveRelevantChunks(
  options: RetrieveOptions
): Promise<RetrievalResult> {
  const startMs = Date.now();
  const topK = Math.max(1, Math.min(options.topK ?? 5, 12));
  const includeAdjacent = options.includeAdjacent ?? true;
  const maxContextChars = options.maxContextChars ?? 8500;

  // Strictly filtered by userId and documentId at the storage layer
  const allChildren = getChildChunksWithEmbeddings(options.userId, options.documentId);
  const allParents = getParentChunks(options.userId, options.documentId);

  if (allChildren.length === 0) {
    return {
      chunks: [],
      parents: [],
      citations: [],
      formattedContext: "",
      latencyMs: Date.now() - startMs,
      reranked: false,
    };
  }

  const queryTokens = extractKeywords(options.query, 18);

  // Embed query via Gemini embedding cache
  let queryVec: Float32Array | null = null;
  let queryNorm = 0;
  try {
    const [embedded] = await embedTextsWithCache([options.query]);
    queryVec = embedded.vector;
    queryNorm = embedded.norm;
  } catch (err) {
    // If query embedding transiently fails, degrade cleanly to lexical retrieval rather than crashing
    console.warn("Query embedding failed, falling back to lexical scoring:", err);
  }

  const scored = allChildren.map((chunk) => {
    const cosine =
      queryVec && chunk.embedding && chunk.embedding.length === queryVec.length
        ? Math.max(0, cosineSimilarity(queryVec, queryNorm, chunk.embedding, chunk.embeddingNorm || 0))
        : 0;
    const lexical = computeLexicalScore(queryTokens, chunk);
    const hybrid = queryVec ? 0.78 * cosine + 0.22 * lexical : lexical;

    return {
      ...chunk,
      score: hybrid,
      cosineScore: cosine,
      lexicalScore: lexical,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, topK);
  const selectedByIndex = new Map<number, (typeof selected)[number] & { isAdjacent?: boolean }>();
  for (const item of selected) {
    selectedByIndex.set(item.chunkIndex, { ...item, isAdjacent: false });
  }

  // Pull adjacent chunks for the top 2 hits when they belong to the same section/document
  if (includeAdjacent && selected.length > 0) {
    const byChunkIndex = new Map(scored.map((c) => [c.chunkIndex, c]));
    for (const anchor of selected.slice(0, 2)) {
      for (const neighborIdx of [anchor.chunkIndex - 1, anchor.chunkIndex + 1]) {
        if (selectedByIndex.has(neighborIdx)) continue;
        const neighbor = byChunkIndex.get(neighborIdx);
        if (neighbor && neighbor.parentId === anchor.parentId) {
          selectedByIndex.set(neighborIdx, { ...neighbor, isAdjacent: true });
        }
      }
    }
  }

  // Sort assembled chunks in natural document reading order so LLM reads coherent prose
  const orderedChunks = Array.from(selectedByIndex.values()).sort(
    (a, b) => a.chunkIndex - b.chunkIndex
  );

  const parentMap = new Map(allParents.map((p) => [p.id, p]));
  const usedParents: ParentChunk[] = [];
  const seenParentIds = new Set<string>();

  const contextBlocks: string[] = [];
  const citations: RetrievedChunkCitation[] = [];
  let charBudgetUsed = 0;

  for (const ch of orderedChunks) {
    if (charBudgetUsed + ch.text.length > maxContextChars && contextBlocks.length > 0) {
      break;
    }

    const parent = parentMap.get(ch.parentId);
    if (parent && !seenParentIds.has(parent.id)) {
      seenParentIds.add(parent.id);
      usedParents.push(parent);
    }

    const pageLabel =
      ch.pageStart === ch.pageEnd
        ? `Page ${ch.pageNumber}`
        : `Pages ${ch.pageStart}-${ch.pageEnd}`;

    contextBlocks.push(
      `[Section: "${ch.sectionTitle}" | ${pageLabel}${ch.isAdjacent ? " | Surrounding Context" : ""}]\n${ch.text}`
    );
    charBudgetUsed += ch.text.length;

    citations.push({
      chunkId: ch.id,
      parentId: ch.parentId,
      sectionTitle: ch.sectionTitle,
      pageNumber: ch.pageNumber,
      pageStart: ch.pageStart,
      pageEnd: ch.pageEnd,
      score: Number(ch.score.toFixed(4)),
      cosineScore: Number(ch.cosineScore.toFixed(4)),
      lexicalScore: Number(ch.lexicalScore.toFixed(4)),
      excerpt: ch.text.slice(0, 180).replace(/\s+/g, " ").trim(),
      isAdjacent: ch.isAdjacent,
    });
  }

  citations.sort((a, b) => b.score - a.score);

  return {
    chunks: orderedChunks,
    parents: usedParents,
    citations,
    formattedContext: contextBlocks.join("\n\n---\n\n"),
    latencyMs: Date.now() - startMs,
    reranked: false,
  };
}
