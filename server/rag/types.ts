export type IngestStage =
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "summarizing"
  | "ready"
  | "error";

export interface ExtractedLine {
  text: string;
  fontSize: number;
  isHeadingCandidate: boolean;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  lines: ExtractedLine[];
}

export interface ExtractedDocument {
  pages: ExtractedPage[];
  pageCount: number;
  totalChars: number;
  detectedHeadings: Array<{ title: string; pageNumber: number }>;
}

export interface ParentChunk {
  id: string;
  documentId: string;
  userId: string;
  contentHash: string;
  sectionTitle: string;
  pageStart: number;
  pageEnd: number;
  orderIndex: number;
  summary: string;
  text: string;
  tokenEstimate: number;
}

export interface ChildChunk {
  id: string;
  parentId: string;
  documentId: string;
  userId: string;
  contentHash: string;
  sectionTitle: string;
  pageNumber: number;
  pageStart: number;
  pageEnd: number;
  chunkIndex: number;
  text: string;
  tokenEstimate: number;
  keywords: string[];
  embedding?: Float32Array;
  embeddingNorm?: number;
}

export interface RagConcept {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  summary: string;
  suggestedExplanationPrompt: string;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
}

export interface ChapterSummary {
  title: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
  keyTerms: string[];
}

export interface KeyDefinition {
  term: string;
  definition: string;
  pageNumber?: number;
}

export interface DocumentStructure {
  overview: string;
  chapters: ChapterSummary[];
  concepts: RagConcept[];
  keyDefinitions: KeyDefinition[];
}

export interface DocumentRecord {
  userId: string;
  documentId: string;
  contentHash: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  parentCount: number;
  stage: IngestStage;
  progress: number;
  message: string;
  error?: string;
  structure?: DocumentStructure;
  storedFilePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedChunkCitation {
  chunkId: string;
  parentId: string;
  sectionTitle: string;
  pageNumber: number;
  pageStart: number;
  pageEnd: number;
  score: number;
  cosineScore: number;
  lexicalScore: number;
  excerpt: string;
  isAdjacent?: boolean;
}

export interface RetrievalResult {
  chunks: Array<ChildChunk & { score: number; cosineScore: number; lexicalScore: number; isAdjacent?: boolean }>;
  parents: ParentChunk[];
  citations: RetrievedChunkCitation[];
  formattedContext: string;
  latencyMs: number;
  reranked: boolean;
}
