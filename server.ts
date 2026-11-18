import express from "express";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { AuthError, resolveRequestUser } from "./server/rag/auth.ts";
import {
  curateSourcesWithRag,
  evaluateFeynmanWithRag,
  generateFlashcardsWithRag,
} from "./server/rag/geminiService.ts";
import {
  awaitActiveIngestionIfPresent,
  startDocumentIngestion,
} from "./server/rag/pipeline.ts";
import { retrieveRelevantChunks } from "./server/rag/retriever.ts";
import {
  deleteDocumentForUser,
  getDocumentRecord,
  getParentChunks,
} from "./server/rag/vectorStore.ts";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "60mb" }));
app.use(express.urlencoded({ limit: "60mb", extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function handleRouteError(res: express.Response, error: any, fallbackMsg: string) {
  if (error instanceof AuthError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(fallbackMsg, error);
  return res.status(500).json({ error: error?.message || fallbackMsg });
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 1. Asynchronous Document Ingestion (supports multipart binary upload or JSON payload)
app.post("/api/rag/ingest", upload.single("file"), async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);

    const fileId = String(req.body?.fileId || req.body?.documentId || "").trim();
    const fileName = String(
      req.body?.fileName || req.file?.originalname || "Uploaded Document"
    ).trim();
    const fileType = String(
      req.body?.fileType || req.file?.mimetype || "text/plain"
    ).trim();
    const fileSize = Number(req.body?.fileSize || req.file?.size || 0);
    const waitForReady = req.body?.wait === true || req.body?.wait === "true" || req.query.wait === "true";

    if (!fileId) {
      return res.status(400).json({ error: "Missing documentId / fileId" });
    }

    const rawBytes = req.file ? new Uint8Array(req.file.buffer) : undefined;
    const textOrDataUrl =
      typeof req.body?.fileContent === "string" ? req.body.fileContent : undefined;

    if (!rawBytes && !textOrDataUrl) {
      return res.status(400).json({ error: "Missing file content or uploaded file binary" });
    }

    const { record, promise } = startDocumentIngestion({
      userId,
      documentId: fileId,
      fileName,
      fileType,
      fileSize,
      rawBytes,
      textOrDataUrl,
    });

    if (waitForReady || record.stage === "ready") {
      const completed = await promise;
      return res.status(completed.stage === "error" ? 500 : 200).json({
        ...completed,
        fileUrl: `/api/rag/document/${encodeURIComponent(fileId)}/file`,
      });
    }

    return res.status(202).json({
      ...record,
      fileUrl: `/api/rag/document/${encodeURIComponent(fileId)}/file`,
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to start document ingestion");
  }
});

// 2. Poll Document Ingestion Status & Cached Structure (user-isolated)
app.get("/api/rag/status/:documentId", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const documentId = String(req.params.documentId || "").trim();
    const record = getDocumentRecord(userId, documentId);
    if (!record) {
      return res.status(404).json({ error: "Document not found for this user" });
    }
    return res.json(record);
  } catch (error) {
    return handleRouteError(res, error, "Failed to read document ingestion status");
  }
});

// 3. Stream Stored Document Binary for PDF Preview (strictly user-isolated)
app.get("/api/rag/document/:documentId/file", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const documentId = String(req.params.documentId || "").trim();
    const record = getDocumentRecord(userId, documentId);
    if (!record || !record.storedFilePath || !fs.existsSync(record.storedFilePath)) {
      return res.status(404).json({ error: "Stored document file not found" });
    }

    const lowerName = record.fileName.toLowerCase();
    const resolvedType =
      record.fileType && record.fileType !== "application/octet-stream"
        ? record.fileType
        : lowerName.endsWith(".pptx")
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : lowerName.endsWith(".ppt")
        ? "application/vnd.ms-powerpoint"
        : lowerName.endsWith(".pdf")
        ? "application/pdf"
        : "application/octet-stream";

    res.setHeader("Content-Type", resolvedType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${record.fileName.replace(/"/g, "")}"`
    );
    return fs.createReadStream(record.storedFilePath).pipe(res);
  } catch (error) {
    return handleRouteError(res, error, "Failed to stream stored document");
  }
});

// 3b. Extracted Sections / Slides Preview (for PPT/PPTX and server-stored files)
app.get("/api/rag/document/:documentId/preview", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const documentId = String(req.params.documentId || "").trim();
    const record = getDocumentRecord(userId, documentId);
    if (!record) {
      return res.status(404).json({ error: "Document not found for this user" });
    }

    const parents = getParentChunks(userId, documentId);
    return res.json({
      fileName: record.fileName,
      fileType: record.fileType,
      pageCount: record.pageCount,
      stage: record.stage,
      overview: record.structure?.overview,
      sections: parents.map((p) => ({
        id: p.id,
        title: p.sectionTitle,
        pageStart: p.pageStart,
        pageEnd: p.pageEnd,
        text: p.text,
      })),
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to load document preview");
  }
});

// 4. Delete Document Vectors & Metadata (strictly user-isolated)
app.delete("/api/rag/document/:documentId", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const documentId = String(req.params.documentId || "").trim();
    const deleted = deleteDocumentForUser(userId, documentId);
    return res.json({ deleted });
  } catch (error) {
    return handleRouteError(res, error, "Failed to delete document index");
  }
});

// 5. Direct Vector + Hybrid Retrieval Endpoint (user- and document-isolated)
app.post("/api/rag/retrieve", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const { documentId, query, topK, includeAdjacent } = req.body || {};
    if (!documentId || !query) {
      return res.status(400).json({ error: "Missing documentId or query" });
    }
    const record = getDocumentRecord(userId, String(documentId));
    if (!record) {
      return res.status(404).json({ error: "Document not found" });
    }
    const result = await retrieveRelevantChunks({
      userId,
      documentId: String(documentId),
      query: String(query),
      topK: typeof topK === "number" ? topK : 5,
      includeAdjacent: includeAdjacent !== false,
    });
    return res.json({
      citations: result.citations,
      latencyMs: result.latencyMs,
      chunkCount: result.chunks.length,
      formattedContext: result.formattedContext,
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to retrieve relevant chunks");
  }
});

// 6. Concept Extraction & Document Structure API (uses cached RAG structure)
app.post("/api/document/concepts", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const { fileId, fileName, fileType, fileContent } = req.body || {};
    const documentId = String(fileId || "").trim();

    let record = documentId ? await awaitActiveIngestionIfPresent(userId, documentId) : null;

    if ((!record || record.stage === "error") && fileContent) {
      const effectiveId = documentId || `doc_${Date.now()}`;
      const { promise } = startDocumentIngestion({
        userId,
        documentId: effectiveId,
        fileName: String(fileName || "Document"),
        fileType: String(fileType || "text/plain"),
        fileSize: typeof fileContent === "string" ? fileContent.length : 0,
        textOrDataUrl: String(fileContent),
      });
      record = await promise;
    }

    if (!record) {
      return res.status(400).json({ error: "Missing file content or unindexed document ID" });
    }
    if (record.stage === "error") {
      return res.status(500).json({ error: record.error || "Document indexing failed" });
    }
    if (!record.structure) {
      return res.status(500).json({ error: "Document structure not available" });
    }

    return res.json({
      concepts: record.structure.concepts,
      overview: record.structure.overview,
      chapters: record.structure.chapters,
      keyDefinitions: record.structure.keyDefinitions,
      pageCount: record.pageCount,
      chunkCount: record.chunkCount,
      contentHash: record.contentHash,
      ragStatus: record.stage,
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to extract concepts");
  }
});

// 7. Feynman Evaluation API (retrieves ONLY relevant chunks + adjacent context)
app.post("/api/feynman/evaluate", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const {
      fileId,
      fileName,
      conceptTitle,
      conceptSummary,
      userExplanation,
      previousChat,
      originalContent,
      fileType,
      userDrawings,
      topK,
    } = req.body || {};

    if (!conceptTitle || !userExplanation) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const documentId = String(fileId || "").trim();
    let record = documentId ? await awaitActiveIngestionIfPresent(userId, documentId) : null;

    // Lazy-index legacy documents that predate the RAG upgrade
    if ((!record || record.stage === "error") && originalContent && documentId) {
      const { promise } = startDocumentIngestion({
        userId,
        documentId,
        fileName: String(fileName || "Study Document"),
        fileType: String(fileType || "text/plain"),
        fileSize: typeof originalContent === "string" ? originalContent.length : 0,
        textOrDataUrl: String(originalContent),
      });
      record = await promise;
    }

    let retrievedContext = "";
    let citations: any[] = [];
    let retrievalLatencyMs = 0;

    if (record && record.stage === "ready") {
      const retrievalQuery = `${conceptTitle}\n${conceptSummary || ""}\n${String(userExplanation).slice(0, 600)}`;
      const retrieval = await retrieveRelevantChunks({
        userId,
        documentId: record.documentId,
        query: retrievalQuery,
        topK: typeof topK === "number" ? topK : 5,
        includeAdjacent: true,
        maxContextChars: 8500,
      });
      retrievedContext = retrieval.formattedContext;
      citations = retrieval.citations;
      retrievalLatencyMs = retrieval.latencyMs;
    }

    if (!retrievedContext) {
      // Fallback for edge cases where no indexed chunks exist (e.g., empty document)
      const isBinaryFallback =
        fileType === "application/pdf" ||
        String(fileType || "").includes("presentation") ||
        String(fileType || "").includes("powerpoint");
      retrievedContext =
        originalContent &&
        typeof originalContent === "string" &&
        !originalContent.startsWith("data:application/pdf") &&
        !originalContent.startsWith("/api/") &&
        !isBinaryFallback
          ? originalContent.slice(0, 8000)
          : `Concept: ${conceptTitle}\nSummary & Key Details: ${conceptSummary || ""}`;
    }

    const evalResult = await evaluateFeynmanWithRag({
      conceptTitle: String(conceptTitle),
      conceptSummary: String(conceptSummary || ""),
      userExplanation: String(userExplanation),
      retrievedContext,
      previousChat: Array.isArray(previousChat) ? previousChat : [],
      userDrawings: Array.isArray(userDrawings) ? userDrawings : [],
    });

    return res.json({
      ...evalResult,
      citations,
      retrievalLatencyMs,
    });
  } catch (error) {
    return handleRouteError(res, error, "Failed to evaluate explanation");
  }
});

// 8. Grounded Flashcards Generation API
app.post("/api/document/flashcards", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const { fileId, fileName, fileType, fileContent, concepts } = req.body || {};
    const documentId = String(fileId || "").trim();

    let record = documentId ? await awaitActiveIngestionIfPresent(userId, documentId) : null;
    if ((!record || record.stage === "error") && fileContent && documentId) {
      const { promise } = startDocumentIngestion({
        userId,
        documentId,
        fileName: String(fileName || "Document"),
        fileType: String(fileType || "text/plain"),
        fileSize: typeof fileContent === "string" ? fileContent.length : 0,
        textOrDataUrl: String(fileContent),
      });
      record = await promise;
    }

    const conceptList =
      record?.structure?.concepts?.length
        ? record.structure.concepts
        : Array.isArray(concepts)
          ? concepts
          : [];

    let groundedContext = "";
    if (record && record.stage === "ready") {
      const query = conceptList.map((c: any) => `${c.title}: ${c.summary}`).join("\n");
      const retrieval = await retrieveRelevantChunks({
        userId,
        documentId: record.documentId,
        query: query || String(fileName || "core concepts"),
        topK: 7,
        includeAdjacent: false,
        maxContextChars: 7500,
      });
      groundedContext = retrieval.formattedContext;
    }

    if (!groundedContext && typeof fileContent === "string" && !fileContent.startsWith("data:")) {
      groundedContext = fileContent.slice(0, 7500);
    }

    const flashcards = await generateFlashcardsWithRag({
      fileName: String(fileName || record?.fileName || "Study Material"),
      concepts: conceptList.map((c: any) => ({
        title: String(c.title || ""),
        summary: String(c.summary || ""),
      })),
      groundedContext:
        groundedContext ||
        conceptList.map((c: any) => `${c.title}: ${c.summary}`).join("\n"),
    });

    return res.json({ flashcards });
  } catch (error) {
    return handleRouteError(res, error, "Failed to generate flashcards");
  }
});

// 9. Contextual Sources Curation API (grounded in RAG structure + retrieved chunks)
app.post("/api/document/sources", async (req, res) => {
  try {
    const { userId } = await resolveRequestUser(req);
    const { fileId, fileName, fileType, fileContent, concepts, searchQuery } = req.body || {};
    const documentId = String(fileId || "").trim();

    let record = documentId ? await awaitActiveIngestionIfPresent(userId, documentId) : null;
    if ((!record || record.stage === "error") && fileContent && documentId) {
      const { promise } = startDocumentIngestion({
        userId,
        documentId,
        fileName: String(fileName || "Document"),
        fileType: String(fileType || "text/plain"),
        fileSize: typeof fileContent === "string" ? fileContent.length : 0,
        textOrDataUrl: String(fileContent),
      });
      record = await promise;
    }

    const conceptList =
      record?.structure?.concepts?.length
        ? record.structure.concepts
        : Array.isArray(concepts)
          ? concepts
          : [];

    let groundedContext = "";
    if (record && record.stage === "ready") {
      const query =
        (searchQuery ? `${searchQuery}\n` : "") +
        conceptList.map((c: any) => `${c.title}: ${c.summary}`).join("\n");
      const retrieval = await retrieveRelevantChunks({
        userId,
        documentId: record.documentId,
        query: query || String(fileName || "study material"),
        topK: 6,
        includeAdjacent: false,
        maxContextChars: 6500,
      });
      groundedContext = retrieval.formattedContext;
    }

    const curated = await curateSourcesWithRag({
      fileName: String(fileName || record?.fileName || "Study Material"),
      concepts: conceptList.map((c: any) => ({
        title: String(c.title || ""),
        summary: String(c.summary || ""),
      })),
      groundedContext:
        groundedContext ||
        conceptList.map((c: any) => `${c.title}: ${c.summary}`).join("\n"),
      searchQuery: typeof searchQuery === "string" ? searchQuery : undefined,
    });

    return res.json(curated);
  } catch (error) {
    return handleRouteError(res, error, "Failed to curate external sources");
  }
});

// Vite & Static Asset Handling
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
