import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ChildChunk,
  DocumentRecord,
  DocumentStructure,
  IngestStage,
  ParentChunk,
} from "./types.ts";

const RAG_ROOT_DIR = path.join(process.cwd(), ".feynman-rag");
const FILES_DIR = path.join(RAG_ROOT_DIR, "files");
const DB_PATH = path.join(RAG_ROOT_DIR, "rag_index.sqlite");

fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    parent_count INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    status_message TEXT NOT NULL DEFAULT '',
    error TEXT,
    structure_json TEXT,
    stored_file_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, document_id)
  );

  CREATE INDEX IF NOT EXISTS idx_documents_user_hash
    ON documents (user_id, content_hash);

  CREATE TABLE IF NOT EXISTS embedding_cache (
    text_hash TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    dims INTEGER NOT NULL,
    embedding_blob BLOB NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS content_structure_cache (
    user_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    structure_json TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, content_hash)
  );

  CREATE TABLE IF NOT EXISTS parent_chunks (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    section_title TEXT NOT NULL,
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    order_index INTEGER NOT NULL,
    summary TEXT NOT NULL,
    text TEXT NOT NULL,
    token_estimate INTEGER NOT NULL,
    PRIMARY KEY (user_id, document_id, id)
  );

  CREATE TABLE IF NOT EXISTS child_chunks (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    section_title TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_estimate INTEGER NOT NULL,
    keywords_json TEXT NOT NULL,
    embedding_blob BLOB NOT NULL,
    embedding_norm REAL NOT NULL,
    PRIMARY KEY (user_id, document_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_child_chunks_user_doc
    ON child_chunks (user_id, document_id, chunk_index);
`);

export function sha256Hex(input: string | Uint8Array): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function floatArrayToBuffer(vec: Float32Array | number[]): Uint8Array {
  const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}

function bufferToFloat32Array(raw: Uint8Array): Float32Array {
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return new Float32Array(copy.buffer);
}

export function computeVectorNorm(vec: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
}

export function saveRawFileForUser(
  userId: string,
  contentHash: string,
  ext: string,
  bytes: Uint8Array
): string {
  const safeUserDir = sha256Hex(userId).slice(0, 24);
  const userDir = path.join(FILES_DIR, safeUserDir);
  fs.mkdirSync(userDir, { recursive: true });
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12) || ".bin";
  const filePath = path.join(userDir, `${contentHash}${safeExt}`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, bytes);
  }
  return filePath;
}

export function upsertDocumentRecord(record: DocumentRecord): void {
  const stmt = db.prepare(`
    INSERT INTO documents (
      user_id, document_id, content_hash, file_name, file_type, file_size,
      page_count, chunk_count, parent_count, stage, progress, status_message,
      error, structure_json, stored_file_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, document_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      file_name = excluded.file_name,
      file_type = excluded.file_type,
      file_size = excluded.file_size,
      page_count = excluded.page_count,
      chunk_count = excluded.chunk_count,
      parent_count = excluded.parent_count,
      stage = excluded.stage,
      progress = excluded.progress,
      status_message = excluded.status_message,
      error = excluded.error,
      structure_json = COALESCE(excluded.structure_json, documents.structure_json),
      stored_file_path = COALESCE(excluded.stored_file_path, documents.stored_file_path),
      updated_at = excluded.updated_at
  `);

  stmt.run(
    record.userId,
    record.documentId,
    record.contentHash,
    record.fileName,
    record.fileType,
    record.fileSize,
    record.pageCount,
    record.chunkCount,
    record.parentCount,
    record.stage,
    record.progress,
    record.message,
    record.error ?? null,
    record.structure ? JSON.stringify(record.structure) : null,
    record.storedFilePath ?? null,
    record.createdAt,
    record.updatedAt
  );
}

export function updateDocumentProgress(
  userId: string,
  documentId: string,
  patch: {
    stage?: IngestStage;
    progress?: number;
    message?: string;
    error?: string | null;
    pageCount?: number;
    chunkCount?: number;
    parentCount?: number;
    structure?: DocumentStructure;
    storedFilePath?: string;
  }
): void {
  const existing = getDocumentRecord(userId, documentId);
  if (!existing) return;

  upsertDocumentRecord({
    ...existing,
    stage: patch.stage ?? existing.stage,
    progress: patch.progress ?? existing.progress,
    message: patch.message ?? existing.message,
    error: patch.error === null ? undefined : (patch.error ?? existing.error),
    pageCount: patch.pageCount ?? existing.pageCount,
    chunkCount: patch.chunkCount ?? existing.chunkCount,
    parentCount: patch.parentCount ?? existing.parentCount,
    structure: patch.structure ?? existing.structure,
    storedFilePath: patch.storedFilePath ?? existing.storedFilePath,
    updatedAt: new Date().toISOString(),
  });
}

function rowToDocumentRecord(row: any): DocumentRecord {
  let structure: DocumentStructure | undefined;
  if (row.structure_json) {
    try {
      structure = JSON.parse(row.structure_json);
    } catch {
      structure = undefined;
    }
  }
  return {
    userId: row.user_id,
    documentId: row.document_id,
    contentHash: row.content_hash,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size,
    pageCount: row.page_count,
    chunkCount: row.chunk_count,
    parentCount: row.parent_count,
    stage: row.stage as IngestStage,
    progress: row.progress,
    message: row.status_message,
    error: row.error ?? undefined,
    structure,
    storedFilePath: row.stored_file_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDocumentRecord(userId: string, documentId: string): DocumentRecord | null {
  const row = db
    .prepare(`SELECT * FROM documents WHERE user_id = ? AND document_id = ?`)
    .get(userId, documentId);
  return row ? rowToDocumentRecord(row) : null;
}

export function findReadyDocumentByHash(userId: string, contentHash: string): DocumentRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM documents WHERE user_id = ? AND content_hash = ? AND stage = 'ready' ORDER BY updated_at DESC LIMIT 1`
    )
    .get(userId, contentHash);
  return row ? rowToDocumentRecord(row) : null;
}

export function listDocumentsForUser(userId: string): DocumentRecord[] {
  const rows = db
    .prepare(`SELECT * FROM documents WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId);
  return rows.map(rowToDocumentRecord);
}

export function getCachedEmbedding(textHash: string, model: string): Float32Array | null {
  const row = db
    .prepare(`SELECT embedding_blob FROM embedding_cache WHERE text_hash = ? AND model = ?`)
    .get(textHash, model) as { embedding_blob: Uint8Array } | undefined;
  if (!row || !row.embedding_blob) return null;
  return bufferToFloat32Array(row.embedding_blob);
}

export function setCachedEmbeddings(
  entries: Array<{ textHash: string; model: string; embedding: Float32Array | number[] }>
): void {
  if (entries.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO embedding_cache (text_hash, model, dims, embedding_blob, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (text_hash) DO UPDATE SET
      model = excluded.model,
      dims = excluded.dims,
      embedding_blob = excluded.embedding_blob
  `);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const item of entries) {
      const blob = floatArrayToBuffer(item.embedding);
      insert.run(item.textHash, item.model, item.embedding.length, blob, now);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getCachedStructure(
  userId: string,
  contentHash: string
): { structure: DocumentStructure; pageCount: number } | null {
  const row = db
    .prepare(
      `SELECT structure_json, page_count FROM content_structure_cache WHERE user_id = ? AND content_hash = ?`
    )
    .get(userId, contentHash) as { structure_json: string; page_count: number } | undefined;
  if (!row) return null;
  try {
    return {
      structure: JSON.parse(row.structure_json) as DocumentStructure,
      pageCount: row.page_count,
    };
  } catch {
    return null;
  }
}

export function setCachedStructure(
  userId: string,
  contentHash: string,
  structure: DocumentStructure,
  pageCount: number
): void {
  db.prepare(`
    INSERT INTO content_structure_cache (user_id, content_hash, structure_json, page_count, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, content_hash) DO UPDATE SET
      structure_json = excluded.structure_json,
      page_count = excluded.page_count
  `).run(userId, contentHash, JSON.stringify(structure), pageCount, new Date().toISOString());
}

export function replaceDocumentChunks(
  userId: string,
  documentId: string,
  parents: ParentChunk[],
  children: ChildChunk[]
): void {
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM child_chunks WHERE user_id = ? AND document_id = ?`).run(
      userId,
      documentId
    );
    db.prepare(`DELETE FROM parent_chunks WHERE user_id = ? AND document_id = ?`).run(
      userId,
      documentId
    );

    const insertParent = db.prepare(`
      INSERT INTO parent_chunks (
        id, user_id, document_id, content_hash, section_title,
        page_start, page_end, order_index, summary, text, token_estimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of parents) {
      insertParent.run(
        p.id,
        userId,
        documentId,
        p.contentHash,
        p.sectionTitle,
        p.pageStart,
        p.pageEnd,
        p.orderIndex,
        p.summary,
        p.text,
        p.tokenEstimate
      );
    }

    const insertChild = db.prepare(`
      INSERT INTO child_chunks (
        id, user_id, document_id, parent_id, content_hash, section_title,
        page_number, page_start, page_end, chunk_index, text, token_estimate,
        keywords_json, embedding_blob, embedding_norm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const c of children) {
      const vec = c.embedding ?? new Float32Array(0);
      const norm = c.embeddingNorm ?? computeVectorNorm(vec);
      insertChild.run(
        c.id,
        userId,
        documentId,
        c.parentId,
        c.contentHash,
        c.sectionTitle,
        c.pageNumber,
        c.pageStart,
        c.pageEnd,
        c.chunkIndex,
        c.text,
        c.tokenEstimate,
        JSON.stringify(c.keywords),
        floatArrayToBuffer(vec),
        norm
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function cloneIndexedDocumentForUser(
  userId: string,
  sourceDocId: string,
  targetDocId: string,
  fileName: string,
  fileType: string,
  fileSize: number
): DocumentRecord | null {
  const source = getDocumentRecord(userId, sourceDocId);
  if (!source || source.stage !== "ready") return null;

  const parents = getParentChunks(userId, sourceDocId);
  const children = getChildChunksWithEmbeddings(userId, sourceDocId);
  const now = new Date().toISOString();

  const clonedParents: ParentChunk[] = parents.map((p) => ({
    ...p,
    documentId: targetDocId,
  }));
  const clonedChildren: ChildChunk[] = children.map((c) => ({
    ...c,
    documentId: targetDocId,
  }));

  replaceDocumentChunks(userId, targetDocId, clonedParents, clonedChildren);

  const newRecord: DocumentRecord = {
    userId,
    documentId: targetDocId,
    contentHash: source.contentHash,
    fileName,
    fileType,
    fileSize,
    pageCount: source.pageCount,
    chunkCount: clonedChildren.length,
    parentCount: clonedParents.length,
    stage: "ready",
    progress: 100,
    message: "Indexed from cache",
    structure: source.structure,
    storedFilePath: source.storedFilePath,
    createdAt: now,
    updatedAt: now,
  };
  upsertDocumentRecord(newRecord);
  return newRecord;
}

export function getParentChunks(userId: string, documentId: string): ParentChunk[] {
  const rows = db
    .prepare(
      `SELECT * FROM parent_chunks WHERE user_id = ? AND document_id = ? ORDER BY order_index ASC`
    )
    .all(userId, documentId) as any[];
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    userId: r.user_id,
    contentHash: r.content_hash,
    sectionTitle: r.section_title,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    orderIndex: r.order_index,
    summary: r.summary,
    text: r.text,
    tokenEstimate: r.token_estimate,
  }));
}

export function getChildChunksWithEmbeddings(userId: string, documentId: string): ChildChunk[] {
  const rows = db
    .prepare(
      `SELECT * FROM child_chunks WHERE user_id = ? AND document_id = ? ORDER BY chunk_index ASC`
    )
    .all(userId, documentId) as any[];
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    documentId: r.document_id,
    userId: r.user_id,
    contentHash: r.content_hash,
    sectionTitle: r.section_title,
    pageNumber: r.page_number,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    chunkIndex: r.chunk_index,
    text: r.text,
    tokenEstimate: r.token_estimate,
    keywords: JSON.parse(r.keywords_json || "[]"),
    embedding: bufferToFloat32Array(r.embedding_blob),
    embeddingNorm: r.embedding_norm,
  }));
}

export function deleteDocumentForUser(userId: string, documentId: string): boolean {
  const existing = getDocumentRecord(userId, documentId);
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM child_chunks WHERE user_id = ? AND document_id = ?`).run(
      userId,
      documentId
    );
    db.prepare(`DELETE FROM parent_chunks WHERE user_id = ? AND document_id = ?`).run(
      userId,
      documentId
    );
    db.prepare(`DELETE FROM documents WHERE user_id = ? AND document_id = ?`).run(
      userId,
      documentId
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Delete raw file only if no other document record for this user references the same path
  if (existing?.storedFilePath && fs.existsSync(existing.storedFilePath)) {
    const stillUsed = db
      .prepare(`SELECT 1 FROM documents WHERE user_id = ? AND stored_file_path = ? LIMIT 1`)
      .get(userId, existing.storedFilePath);
    if (!stillUsed) {
      try {
        fs.unlinkSync(existing.storedFilePath);
      } catch {
        // ignore unlink errors
      }
    }
  }
  return Boolean(existing);
}
