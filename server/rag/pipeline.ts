import { buildHierarchicalChunks } from "./chunker.ts";
import {
  extractPdfDocument,
  extractPptBinaryDocument,
  extractPptxDocument,
  extractTextDocument,
} from "./extractor.ts";
import {
  embedTextsWithCache,
  extractDocumentStructure,
  transcribeImageStudyMaterial,
} from "./geminiService.ts";
import type { DocumentRecord, ExtractedDocument } from "./types.ts";
import {
  cloneIndexedDocumentForUser,
  findReadyDocumentByHash,
  getCachedStructure,
  getDocumentRecord,
  replaceDocumentChunks,
  saveRawFileForUser,
  setCachedStructure,
  sha256Hex,
  updateDocumentProgress,
  upsertDocumentRecord,
} from "./vectorStore.ts";

// Track in-flight ingestion promises so concurrent requests can await or deduplicate cleanly
const activeJobs = new Map<string, Promise<DocumentRecord>>();

function makeJobKey(userId: string, documentId: string): string {
  return `${userId}::${documentId}`;
}

export interface IngestInput {
  userId: string;
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  rawBytes?: Uint8Array;
  textOrDataUrl?: string;
}

function decodeBase64DataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) {
    throw new Error("Invalid data URL payload");
  }
  const meta = dataUrl.slice(5, commaIdx);
  const mime = meta.split(";")[0] || "application/octet-stream";
  const b64 = dataUrl.slice(commaIdx + 1).replace(/\s+/g, "");
  return {
    mime,
    bytes: new Uint8Array(Buffer.from(b64, "base64")),
  };
}

function getFileExtension(fileName: string, fileType: string): string {
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  if (match) return `.${match[1].toLowerCase()}`;
  if (fileType === "application/pdf") return ".pdf";
  if (
    fileType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return ".pptx";
  }
  if (fileType === "application/vnd.ms-powerpoint") return ".ppt";
  if (fileType.startsWith("image/")) return `.${fileType.split("/")[1] || "png"}`;
  return ".txt";
}

export function startDocumentIngestion(input: IngestInput): {
  record: DocumentRecord;
  promise: Promise<DocumentRecord>;
} {
  const jobKey = makeJobKey(input.userId, input.documentId);
  const existingPromise = activeJobs.get(jobKey);
  if (existingPromise) {
    const existingRecord = getDocumentRecord(input.userId, input.documentId)!;
    return { record: existingRecord, promise: existingPromise };
  }

  let binaryBytes: Uint8Array | null = input.rawBytes ?? null;
  let plainText: string | null = null;
  let effectiveMime = input.fileType || "text/plain";

  if (!binaryBytes && input.textOrDataUrl) {
    if (input.textOrDataUrl.startsWith("data:")) {
      const decoded = decodeBase64DataUrl(input.textOrDataUrl);
      binaryBytes = decoded.bytes;
      if (effectiveMime === "text/plain" && decoded.mime) {
        effectiveMime = decoded.mime;
      }
    } else {
      plainText = input.textOrDataUrl;
    }
  }

  const lowerName = input.fileName.toLowerCase();
  const isPdf =
    effectiveMime === "application/pdf" ||
    lowerName.endsWith(".pdf");
  const isZipBytes = Boolean(binaryBytes && binaryBytes.length >= 2 && binaryBytes[0] === 0x50 && binaryBytes[1] === 0x4b);
  const isPptx =
    effectiveMime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    lowerName.endsWith(".pptx") ||
    (lowerName.endsWith(".ppt") && isZipBytes);
  const isPpt =
    !isPptx &&
    (effectiveMime === "application/vnd.ms-powerpoint" || lowerName.endsWith(".ppt"));
  const isImage = effectiveMime.startsWith("image/");

  const hashSource = binaryBytes ?? Buffer.from(plainText || input.fileName, "utf8");
  const contentHash = sha256Hex(hashSource);

  // Check if this exact user ALREADY has an identical document indexed and ready
  const existingReadySameDoc = getDocumentRecord(input.userId, input.documentId);
  if (
    existingReadySameDoc &&
    existingReadySameDoc.stage === "ready" &&
    existingReadySameDoc.contentHash === contentHash
  ) {
    return {
      record: existingReadySameDoc,
      promise: Promise.resolve(existingReadySameDoc),
    };
  }

  const duplicateForUser = findReadyDocumentByHash(input.userId, contentHash);
  if (duplicateForUser) {
    const cloned = cloneIndexedDocumentForUser(
      input.userId,
      duplicateForUser.documentId,
      input.documentId,
      input.fileName,
      effectiveMime,
      input.fileSize || hashSource.byteLength
    );
    if (cloned) {
      return {
        record: cloned,
        promise: Promise.resolve(cloned),
      };
    }
  }

  // Save raw file on disk for PDF preview streaming & future reference
  let storedFilePath: string | undefined;
  if (binaryBytes) {
    storedFilePath = saveRawFileForUser(
      input.userId,
      contentHash,
      getFileExtension(input.fileName, effectiveMime),
      binaryBytes
    );
  } else if (plainText !== null) {
    storedFilePath = saveRawFileForUser(
      input.userId,
      contentHash,
      getFileExtension(input.fileName, effectiveMime),
      Buffer.from(plainText, "utf8")
    );
  }

  const now = new Date().toISOString();
  const initialRecord: DocumentRecord = {
    userId: input.userId,
    documentId: input.documentId,
    contentHash,
    fileName: input.fileName,
    fileType: effectiveMime,
    fileSize: input.fileSize || hashSource.byteLength,
    pageCount: 0,
    chunkCount: 0,
    parentCount: 0,
    stage: "extracting",
    progress: 8,
    message: isPdf
      ? "Extracting text & page structure..."
      : isPptx || isPpt
      ? "Extracting slides & speaker notes..."
      : "Preprocessing document text...",
    storedFilePath,
    createdAt: now,
    updatedAt: now,
  };
  upsertDocumentRecord(initialRecord);

  const runPromise = (async (): Promise<DocumentRecord> => {
    try {
      let extracted: ExtractedDocument;

      if (isPdf && binaryBytes) {
        extracted = await extractPdfDocument(binaryBytes, (done, total) => {
          const pct = Math.min(35, 10 + Math.round((done / Math.max(1, total)) * 25));
          updateDocumentProgress(input.userId, input.documentId, {
            stage: "extracting",
            progress: pct,
            pageCount: total,
            message: `Extracting pages (${done}/${total})...`,
          });
        });
      } else if (isPptx && binaryBytes) {
        extracted = await extractPptxDocument(binaryBytes, input.fileName, (done, total) => {
          const pct = Math.min(35, 10 + Math.round((done / Math.max(1, total)) * 25));
          updateDocumentProgress(input.userId, input.documentId, {
            stage: "extracting",
            progress: pct,
            pageCount: total,
            message: `Extracting slides (${done}/${total})...`,
          });
        });
      } else if (isPpt && binaryBytes) {
        updateDocumentProgress(input.userId, input.documentId, {
          stage: "extracting",
          progress: 22,
          message: "Extracting legacy PowerPoint slides...",
        });
        extracted = extractPptBinaryDocument(binaryBytes, input.fileName);
      } else if (isImage && binaryBytes) {
        updateDocumentProgress(input.userId, input.documentId, {
          stage: "extracting",
          progress: 20,
          message: "Transcribing lecture slide / diagram...",
        });
        const transcribed = await transcribeImageStudyMaterial(
          Buffer.from(binaryBytes).toString("base64"),
          effectiveMime,
          input.fileName
        );
        extracted = extractTextDocument(transcribed, input.fileName);
      } else {
        const textContent =
          plainText ?? (binaryBytes ? Buffer.from(binaryBytes).toString("utf8") : "");
        extracted = extractTextDocument(textContent, input.fileName);
      }

      // Stage 2: Semantic & hierarchical chunking
      updateDocumentProgress(input.userId, input.documentId, {
        stage: "chunking",
        progress: 40,
        pageCount: extracted.pageCount,
        message: `Building hierarchical chunks across ${extracted.pageCount} pages...`,
      });

      const { parents, children } = buildHierarchicalChunks(extracted, {
        userId: input.userId,
        documentId: input.documentId,
        contentHash,
        fileName: input.fileName,
      });

      updateDocumentProgress(input.userId, input.documentId, {
        stage: "embedding",
        progress: 48,
        pageCount: extracted.pageCount,
        parentCount: parents.length,
        chunkCount: children.length,
        message: `Generating embeddings for ${children.length} segments...`,
      });

      // Stage 3: Batch embedding generation with cache lookup
      const textsToEmbed = children.map(
        (c) => `[Section: ${c.sectionTitle} | Page ${c.pageNumber}]\n${c.text}`
      );

      const vectors = await embedTextsWithCache(textsToEmbed, (done, total) => {
        const pct = Math.min(82, 48 + Math.round((done / Math.max(1, total)) * 34));
        updateDocumentProgress(input.userId, input.documentId, {
          stage: "embedding",
          progress: pct,
          message: `Embedding chunks (${done}/${total})...`,
        });
      });

      for (let i = 0; i < children.length; i++) {
        children[i].embedding = vectors[i].vector;
        children[i].embeddingNorm = vectors[i].norm;
      }

      // Stage 4: Indexing chunks into persistent user-isolated SQLite vector index
      updateDocumentProgress(input.userId, input.documentId, {
        stage: "indexing",
        progress: 86,
        message: "Indexing vectors & metadata...",
      });

      replaceDocumentChunks(input.userId, input.documentId, parents, children);

      // Stage 5: Document overview & topic hierarchy (cached per user + contentHash)
      updateDocumentProgress(input.userId, input.documentId, {
        stage: "summarizing",
        progress: 92,
        message: "Building cached overview & Knowledge Map topics...",
      });

      let structure = getCachedStructure(input.userId, contentHash)?.structure;
      if (!structure) {
        structure = await extractDocumentStructure({
          fileName: input.fileName,
          pageCount: extracted.pageCount,
          parents,
          detectedHeadings: extracted.detectedHeadings,
        });
        setCachedStructure(input.userId, contentHash, structure, extracted.pageCount);
      }

      updateDocumentProgress(input.userId, input.documentId, {
        stage: "ready",
        progress: 100,
        pageCount: extracted.pageCount,
        parentCount: parents.length,
        chunkCount: children.length,
        structure,
        error: null,
        message: `Indexed ${extracted.pageCount} ${extracted.pageCount === 1 ? "page" : "pages"} · ${children.length} chunks ready`,
      });

      return getDocumentRecord(input.userId, input.documentId)!;
    } catch (err: any) {
      const errorMsg = err?.message || "Failed to index document.";
      console.error(`RAG ingestion failed for ${input.fileName} (${input.documentId}):`, err);
      updateDocumentProgress(input.userId, input.documentId, {
        stage: "error",
        progress: 100,
        error: errorMsg,
        message: `Indexing error: ${errorMsg}`,
      });
      return getDocumentRecord(input.userId, input.documentId)!;
    } finally {
      activeJobs.delete(jobKey);
    }
  })();

  activeJobs.set(jobKey, runPromise);
  return { record: initialRecord, promise: runPromise };
}

export async function awaitActiveIngestionIfPresent(
  userId: string,
  documentId: string
): Promise<DocumentRecord | null> {
  const existing = activeJobs.get(makeJobKey(userId, documentId));
  if (existing) {
    return await existing;
  }
  return getDocumentRecord(userId, documentId);
}
