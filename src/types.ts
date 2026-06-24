export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string; // The text content or base64 data url
  uploadedAt: string;
  knowledgeMap?: string;
}

export interface Concept {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  summary: string;
  suggestedExplanationPrompt: string;
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

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
  streak?: number;
  avgMastery?: number;
  totalTimeStudied: number; // stored in seconds or minutes
  totalTopicsMastered: number;
  topicsMastered?: number; // matches image schema field key exactly
  createdAt: string;
  lastLogin: string;
  settings: Record<string, any>;
}

