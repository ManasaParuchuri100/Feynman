export type RagStage =
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "summarizing"
  | "ready"
  | "error";

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

export interface RetrievalCitation {
  chunkId: string;
  parentId: string;
  sectionTitle: string;
  pageNumber: number;
  pageStart: number;
  pageEnd: number;
  score: number;
  excerpt: string;
  isAdjacent?: boolean;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string; // The text content, base64 data url, or /api/rag/document/:id/file reference
  uploadedAt: string;
  knowledgeMap?: string;
  contentHash?: string;
  ragStage?: RagStage;
  ragProgress?: number;
  ragMessage?: string;
  ragError?: string;
  pageCount?: number;
  chunkCount?: number;
  documentOverview?: string;
  chapters?: ChapterSummary[];
  keyDefinitions?: KeyDefinition[];
}

export interface Concept {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  summary: string;
  suggestedExplanationPrompt: string;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface FeynmanSession {
  fileId: string;
  currentConceptId: string;
  concepts: Concept[];
  chatHistory: ChatMessage[];
  learningProgress: number; // percentage completed
  scoreCard?: {
    clarity: number; // 0 - 100
    accuracy: number; // 0 - 100
    simplicity: number; // 0 - 100
    completeness: number; // 0 - 100
    gaps: string[];
    suggestions: string;
  };
}

export interface Flashcard {
  id: string;
  conceptTitle: string;
  cardType?: "mcq" | "fill_blank";
  question: string;
  answer: string;
  difficulty?: "Easy" | "Medium" | "Hard";
  options?: string[];
  explanation?: string;
  explainWhy?: string;
  whatAbout?: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
  streak?: number;
  avgMastery?: number;
  totalTopicsMastered: number;
  topicsMastered?: number; // matches image schema field key exactly
  totalTimeStudied: number; // stored in seconds or minutes
  createdAt: string;
  lastLogin: string;
  settings: Record<string, any>;
}

export type ResourceCategory = "All" | "Articles" | "Documentation" | "Videos" | "Research Papers" | "Further Reading";

export interface StudyResource {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  type: "Articles" | "Documentation" | "Videos" | "Research Papers" | "Further Reading";
  relevanceReason: string;
}

export interface SourcesResponse {
  aiExplanation: string;
  topics: string[];
  resources: StudyResource[];
}
