import React, { useState, useEffect, useRef } from "react";
import { UploadedFile, Concept, ChatMessage, Flashcard, RetrievalCitation } from "../types";
import { 
  ArrowLeft, 
  PanelLeftOpen,
  BookOpen, 
  ChevronRight, 
  Send, 
  Award, 
  AlertTriangle, 
  CheckCircle, 
  Lightbulb,
  Mic,
  Pencil,
  Eraser,
  MousePointer,
  Trash2,
  CheckCircle2,
  X,
  Play,
  Square,
  Pause,
  RotateCcw,
  Sliders,
  TrendingUp,
  BrainCircuit,
  PieChart,
  ArrowRight,
  Download,
  ExternalLink,
  Milestone,
  Sparkles,
  Timer,
  Layers,
  RotateCw,
  Shuffle,
  Check,
  HelpCircle,
  Flame,
  GraduationCap,
  Filter,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  auth, 
  getUserProfile, 
  syncUserProfile, 
  updateUserProfileStats, 
  onAuthStateChanged,
  saveUploadedFileToFirestore,
  saveTopicToFirestore,
  saveExplanationToFirestore,
  saveFeedbackToFirestore,
  saveAchievementToFirestore,
  getFileKnowledgeMap
} from "../lib/firebase";
import { UserProfile } from "../types";
import SourcesTab from "./SourcesTab";
import ThemeToggle from "./ThemeToggle";
import { useTheme } from "../lib/theme";
import PdfViewer from "./PdfViewer";
import { authFetch } from "../lib/api";

interface FeynmanArenaProps {
  file: UploadedFile;
  allFiles?: UploadedFile[];
  onBack: () => void;
  onUpdateFileMeta?: (fileId: string, patch: Partial<UploadedFile>) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

type TabType = "explain" | "feedback" | "map" | "sources" | "progress";

interface ExplanationBlock {
  id: string;
  type: "text" | "voice" | "drawing";
  content: string;
  duration?: number;
  timestamp: string;
  strokes?: Stroke[];
  audioUrl?: string;
}

interface Stroke {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export default function FeynmanArena({
  file,
  allFiles,
  onBack,
  onUpdateFileMeta,
  isSidebarCollapsed = false,
  onToggleSidebar
}: FeynmanArenaProps) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>("explain");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [explanationText, setExplanationText] = useState("");
  const [explanationBlocks, setExplanationBlocks] = useState<ExplanationBlock[]>([]);
  const [currentlyPlayingBlockId, setCurrentlyPlayingBlockId] = useState<string | null>(null);
  const [promptGuide, setPromptGuide] = useState("Explain like you are explaining to a 10 year old");
  
  // Custom mock drawing and voice records structures
  const [isDrawingOpen, setIsDrawingOpen] = useState(false);
  const [drawingMode, setDrawingMode] = useState<"pen" | "eraser" | "type">("type");
  const [brushColor, setBrushColor] = useState<string>("#d946ef");
  const [brushWidth, setBrushWidth] = useState<number>(3);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [isSourceDocumentOpen, setIsSourceDocumentOpen] = useState(false);
  const [pdfActionUrl, setPdfActionUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [previewSections, setPreviewSections] = useState<Array<{ id: string; title: string; pageStart: number; pageEnd: number; text: string }>>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Flashcards quiz state
  const [mapSubView, setMapSubView] = useState<"orbit" | "quiz">("orbit");
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loadingFlashcards, setLoadingFlashcards] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [conceptFilter, setConceptFilter] = useState<string>("all");
  const [masteredCardIds, setMasteredCardIds] = useState<Set<string>>(new Set());
  const [reviewCardIds, setReviewCardIds] = useState<Set<string>>(new Set());
  const [quizCompleted, setQuizCompleted] = useState(false);

  const generateDefaultFlashcardsFromConcepts = (conceptList: Concept[]): Flashcard[] => {
    if (!conceptList || conceptList.length === 0) return [];
    const cards: Flashcard[] = [];

    // Collect all real concept titles
    const allTitles = conceptList.map(c => c.title);
    
    // Extract key capitalized terms or noun phrases from concept summaries
    const documentTerms: string[] = [];
    conceptList.forEach(c => {
      const matches = c.summary.match(/\b[A-Z][a-zA-Z0-9'-]+(?:\s+[A-Z][a-zA-Z0-9'-]+)*\b/g) || [];
      matches.forEach(m => {
        if (m.length > 3 && !documentTerms.includes(m) && !allTitles.includes(m)) {
          documentTerms.push(m);
        }
      });
    });

    const getContextualOptions = (correctAnswer: string, conceptIdx: number): string[] => {
      // Option pool consists ONLY of other concept titles and real extracted document terms
      const pool = [
        ...allTitles.filter(t => t.toLowerCase().trim() !== correctAnswer.toLowerCase().trim()),
        ...documentTerms.filter(t => t.toLowerCase().trim() !== correctAnswer.toLowerCase().trim())
      ];

      const distractors: string[] = [];
      let step = 0;

      while (distractors.length < 3 && pool.length > 0) {
        const randIdx = (conceptIdx + step * 3) % pool.length;
        const candidate = pool.splice(randIdx, 1)[0];
        if (candidate && !distractors.includes(candidate) && candidate.toLowerCase().trim() !== correctAnswer.toLowerCase().trim()) {
          distractors.push(candidate);
        }
        step++;
      }

      // If pool is small, generate domain-tied variations of the correct answer
      if (distractors.length < 3) {
        const words = correctAnswer.split(" ");
        const mainTerm = words[words.length - 1] || correctAnswer;
        const domainPrefixes = ["Inverse", "Relative", "Secondary", "Sub-", "Non-"];
        for (const prefix of domainPrefixes) {
          if (distractors.length >= 3) break;
          const variation = words.length > 1 ? `${prefix} ${words.slice(1).join(" ")}` : `${prefix}-${mainTerm}`;
          if (variation.toLowerCase() !== correctAnswer.toLowerCase() && !distractors.includes(variation)) {
            distractors.push(variation);
          }
        }
      }

      return [correctAnswer, ...distractors.slice(0, 3)].sort(() => 0.5 - Math.random());
    };

    conceptList.forEach((c, idx) => {
      const mcqOptions = getContextualOptions(c.title, idx);
      const fillOptions = getContextualOptions(c.title, idx + 10);

      // 1. Fun MCQ Flashcard
      cards.push({
        id: `def-${idx}-mcq`,
        conceptTitle: c.title,
        cardType: "mcq",
        question: `⚡ Quick Brain Teaser: Which concept or term is defined as: "${c.summary}"?`,
        answer: c.title,
        difficulty: c.difficulty,
        options: mcqOptions,
        explainWhy: `"${c.title}" matches the core definition provided in your uploaded notes!`,
        whatAbout: `Mastering ${c.title} (${c.difficulty} difficulty) helps lock in your understanding of the broader topic.`
      });

      // 2. Fun Fill in the Blank Flashcard
      cards.push({
        id: `def-${idx}-fill`,
        conceptTitle: c.title,
        cardType: "fill_blank",
        question: `🎯 Fill in the blank: "When studying this topic, ___ plays the vital role of: ${c.summary}"`,
        answer: c.title,
        difficulty: c.difficulty,
        options: fillOptions,
        explainWhy: `"${c.title}" is the precise term that completes this definition perfectly.`,
        whatAbout: `Active recall through fill-in-the-blanks forces your brain to recall terms without passive recognition.`
      });
    });
    return cards;
  };

  const handleGenerateAiFlashcards = async () => {
    if (loadingFlashcards) return;
    setLoadingFlashcards(true);
    try {
      const inlineContent =
        file.content && !file.content.startsWith("/api/") && file.content.length < 300_000
          ? file.content
          : undefined;
      const res = await authFetch("/api/document/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          fileName: file.name,
          fileType: file.type,
          fileContent: inlineContent,
          concepts: concepts
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.flashcards && Array.isArray(data.flashcards) && data.flashcards.length > 0) {
          const formatted: Flashcard[] = data.flashcards.map((f: any, index: number) => ({
            id: `ai-card-${index}-${Date.now()}`,
            conceptTitle: f.conceptTitle || (concepts[index % concepts.length]?.title || "General"),
            cardType: f.cardType === "fill_blank" || f.cardType === "mcq" ? f.cardType : (index % 2 === 0 ? "mcq" : "fill_blank"),
            question: f.question,
            answer: f.answer,
            difficulty: f.difficulty || "Medium",
            options: f.options || [],
            explanation: f.explanation || "",
            explainWhy: f.explainWhy || f.explanation || "Directly verified against the uploaded document text.",
            whatAbout: f.whatAbout || `This question tests core understanding of ${f.conceptTitle || "the topic"}.`
          }));
          setFlashcards(formatted);
          setCurrentCardIndex(0);
          setIsCardFlipped(false);
          setSelectedOption(null);
          setQuizCompleted(false);
          setMasteredCardIds(new Set());
          setReviewCardIds(new Set());
        }
      }
    } catch (err) {
      console.error("Failed to generate AI flashcards:", err);
    } finally {
      setLoadingFlashcards(false);
    }
  };

  const handleSelectConcept = (concept: Concept) => {
    setSelectedConcept(concept);
    setActiveTab("explain");
  };

  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);

  // Scorecards for each concept
  const [scoreCards, setScoreCards] = useState<{
    [conceptId: string]: {
      clarity: number;
      accuracy: number;
      simplicity: number;
      completeness: number;
      gaps: string[];
      suggestions: string;
      feedbackText: string;
      diagramUnderstanding?: string;
      citations?: RetrievalCitation[];
      retrievalLatencyMs?: number;
    };
  }>({});

  const [revisedConcepts, setRevisedConcepts] = useState<string[]>([]);
  const [showRevisedToast, setShowRevisedToast] = useState(false);

  // Dynamic study activity logs
  const [studyLog, setStudyLog] = useState<{ date: string; concept: string; score?: number }[]>(() => {
    const cached = localStorage.getItem("feynman_study_log") || localStorage.getItem("feymann_study_log");
    let initialList: { date: string; concept: string; score?: number }[] = [];
    if (cached) {
      try {
        initialList = JSON.parse(cached);
      } catch (e) {
        initialList = [];
      }
    }
    
    if (initialList.length === 0) {
      const uploadDateStr = file.uploadedAt ? file.uploadedAt.split("T")[0] : new Date().toISOString().split("T")[0];
      initialList = [{ date: uploadDateStr, concept: "Document Uploaded" }];
    }

    // Auto-register study session for today if not already present to increment streak daily on load
    const todayStr = new Date().toISOString().split("T")[0];
    const hasToday = initialList.some(item => item.date === todayStr);
    if (!hasToday) {
      initialList = [{ date: todayStr, concept: "Daily Study Session Started" }, ...initialList];
      localStorage.setItem("feynman_study_log", JSON.stringify(initialList));
    }
    return initialList;
  });

  // Real second-by-second active timer to replace hardcoded placeholders with daily reset
  const [studySeconds, setStudySeconds] = useState(() => {
    const today = new Date().toISOString().split("T")[0];
    const storedDate = localStorage.getItem("feynman_study_seconds_date") || localStorage.getItem("feymann_study_seconds_date");
    const storedSeconds = localStorage.getItem("feynman_study_seconds") || localStorage.getItem("feymann_study_seconds");

    if (!storedDate) {
      // First time initialization
      localStorage.setItem("feynman_study_seconds_date", today);
      localStorage.setItem("feynman_study_seconds", "120"); // 2 minutes start for aesthetic appeal on first load
      return 120;
    }

    if (storedDate !== today) {
      // New day detected on load - reset timer to zero
      localStorage.setItem("feynman_study_seconds", "0");
      localStorage.setItem("feynman_study_seconds_date", today);
      return 0;
    }

    return storedSeconds ? parseInt(storedSeconds, 10) : 120;
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        getUserProfile(user.uid).then((prof) => {
          if (prof) {
            setUserProfile(prof);
          } else {
            syncUserProfile(user.uid, user.email || "", user.displayName || "").then((newProf) => {
              setUserProfile(newProf);
            });
          }
        });
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const today = new Date().toISOString().split("T")[0];
      const storedDate = localStorage.getItem("feynman_study_seconds_date") || localStorage.getItem("feymann_study_seconds_date") || today;

      if (storedDate !== today) {
        // Handle midnight crossing/new calendar day transition in real-time
        localStorage.setItem("feynman_study_seconds_date", today);
        localStorage.setItem("feynman_study_seconds", "0");
        setStudySeconds(0);
      } else {
        setStudySeconds(prev => {
          const next = prev + 1;
          localStorage.setItem("feynman_study_seconds", next.toString());
          
          // Periodically update total study time in Firestore (every 10 seconds)
          if (next % 10 === 0 && auth.currentUser) {
            getUserProfile(auth.currentUser.uid).then(prof => {
              if (prof) {
                const updatedTime = prof.totalTimeStudied + 10;
                updateUserProfileStats(auth.currentUser!.uid, { totalTimeStudied: updatedTime });
                setUserProfile(prevProf => prevProf ? { ...prevProf, totalTimeStudied: updatedTime } : null);
              }
            });
          }
          return next;
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSourceDocumentOpen(false);
      }
    };
    if (isSourceDocumentOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSourceDocumentOpen]);

  useEffect(() => {
    if (!isSourceDocumentOpen) {
      setPdfActionUrl(null);
      setPdfPageCount(null);
      setPreviewSections([]);
      setPreviewError(null);
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || file.content.startsWith("data:application/pdf") || lowerName.endsWith(".pdf");
    const isImg = Boolean(file.type?.startsWith("image/") || file.content.startsWith("data:image/"));
    const isPpt = file.type.includes("presentation") || file.type.includes("powerpoint") || lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx");

    if (!isPdf && !isImg && (isPpt || file.content.startsWith("/api/rag/document/"))) {
      let cancelled = false;
      setLoadingPreview(true);
      setPreviewError(null);
      authFetch(`/api/rag/document/${encodeURIComponent(file.id)}/preview`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Unable to load slide preview yet.");
          return res.json();
        })
        .then((data) => {
          if (!cancelled && Array.isArray(data.sections)) {
            setPreviewSections(data.sections);
          }
        })
        .catch((err) => {
          if (!cancelled) setPreviewError(err?.message || "Slide preview unavailable.");
        })
        .finally(() => {
          if (!cancelled) setLoadingPreview(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [isSourceDocumentOpen, file.id, file.ragStage]);

  const handleDownloadOriginalFile = async () => {
    try {
      const targetUrl = file.content.startsWith("/api/")
        ? file.content
        : `/api/rag/document/${encodeURIComponent(file.id)}/file`;
      const res = await authFetch(targetUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
    } catch (err) {
      console.error("Failed to download original file:", err);
    }
  };

  useEffect(() => {
    if (concepts && concepts.length > 0 && flashcards.length === 0) {
      const defaults = generateDefaultFlashcardsFromConcepts(concepts);
      setFlashcards(defaults);
    }
  }, [concepts]);

  const handleMarkRevised = () => {
    const key = selectedConcept ? selectedConcept.title : "global";
    if (!revisedConcepts.includes(key)) {
      setRevisedConcepts(prev => [...prev, key]);
    }

    // Capture actual training revision activity
    const newLog = {
      date: new Date().toISOString().split("T")[0],
      concept: `Revised: ${key}`
    };
    setStudyLog(prev => {
      const next = [newLog, ...prev];
      localStorage.setItem("feynman_study_log", JSON.stringify(next));
      return next;
    });

    setShowRevisedToast(true);
    setTimeout(() => {
      setShowRevisedToast(false);
    }, 3000);
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const speechIntervalRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);
  const shouldRecordRef = useRef<boolean>(false);

  // Audio Recording & Playback refs for original voice notes
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const initialExplanationTextRef = useRef<string>("");
  const currentSessionTranscriptRef = useRef<string>("");

  // Cleanup speech/active processes on unmount
  useEffect(() => {
    return () => {
      shouldRecordRef.current = false;
      if (speechIntervalRef.current) {
        clearInterval(speechIntervalRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore
        }
      }
      if (audioStreamRef.current) {
        try {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
        } catch (e) {
          // ignore
        }
      }
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {
          // ignore
        }
      }
      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause();
          activeAudioRef.current = null;
        } catch (e) {
          // ignore
        }
      }
    };
  }, []);

  // Hydrate concepts automatically when background RAG ingestion finishes
  useEffect(() => {
    if (!file.knowledgeMap) return;
    try {
      const parsed = JSON.parse(file.knowledgeMap);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setConcepts(parsed);
        setSelectedConcept((prev) => prev || parsed[0]);
        setLoadingConcepts(false);
        setErrorHeader(null);
      }
    } catch {
      // ignore malformed JSON
    }
  }, [file.id, file.knowledgeMap]);

  // Extract concepts from document when switching files (keyed ONLY on file.id so polling updates don't wipe user drafts)
  useEffect(() => {
    // Clear state for the new file to prevent bleed-through of previous files' info
    setExplanationText("");
    setExplanationBlocks([]);
    setCurrentlyPlayingBlockId(null);
    setStrokes([]);
    setVoiceTranscript("");
    setConcepts([]);
    setSelectedConcept(null);
    setScoreCards({});
    setRevisedConcepts([]);
    setGradingError(null);
    setFlashcards([]);

    // Reset speech and audio playing on changing files
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
    }
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      } catch (e) {
        // ignore
      }
    }

    let cancelled = false;

    async function fetchConcepts() {
      setLoadingConcepts(true);
      setErrorHeader(null);

      // Helper to update localStorage and Firestore caches
      const updateLocationCaches = (conceptsList: Concept[], overview?: string) => {
        try {
          const listStr = JSON.stringify(conceptsList);
          onUpdateFileMeta?.(file.id, {
            knowledgeMap: listStr,
            ...(overview ? { documentOverview: overview } : {}),
          });
          if (auth.currentUser) {
            saveUploadedFileToFirestore(auth.currentUser.uid, file.id, file.name, file.content, listStr, conceptsList, {
              contentHash: file.contentHash,
              ragStatus: file.ragStage || "ready",
              pageCount: file.pageCount,
              chunkCount: file.chunkCount,
              documentOverview: overview || file.documentOverview,
            });
          }
        } catch (e) {
          console.error("Failed to update cache:", e);
        }
      };

      try {
        // Step 1: Check if concepts are already in file object
        if (file.knowledgeMap) {
          try {
            const parsed = JSON.parse(file.knowledgeMap);
            if (Array.isArray(parsed) && parsed.length > 0) {
              if (!cancelled) {
                setConcepts(parsed);
                setSelectedConcept(parsed[0]);
                setLoadingConcepts(false);
              }
              return;
            }
          } catch (e) {
            console.error("Failed parsing file.knowledgeMap:", e);
          }
        }

        // Step 2: Check standard localStorage files cache
        const storageKey = auth.currentUser ? `feynman_uploaded_files_${auth.currentUser.uid}` : "feynman_uploaded_files_guest";
        const localCached = localStorage.getItem(storageKey);
        if (localCached) {
          try {
            const parsedList = JSON.parse(localCached);
            const foundFile = parsedList.find((f: any) => f.id === file.id);
            if (foundFile && foundFile.knowledgeMap) {
              const parsed = JSON.parse(foundFile.knowledgeMap);
              if (Array.isArray(parsed) && parsed.length > 0) {
                if (!cancelled) {
                  setConcepts(parsed);
                  setSelectedConcept(parsed[0]);
                  setLoadingConcepts(false);
                }
                return;
              }
            }
          } catch (e) {
            console.error("Failed parsing local cached map:", e);
          }
        }

        // Step 3: Check Firestore nested upload record
        if (auth.currentUser) {
          const cloudMap = await getFileKnowledgeMap(auth.currentUser.uid, file.id);
          if (cloudMap) {
            try {
              const parsed = JSON.parse(cloudMap);
              if (Array.isArray(parsed) && parsed.length > 0) {
                if (!cancelled) {
                  setConcepts(parsed);
                  setSelectedConcept(parsed[0]);
                  updateLocationCaches(parsed);
                  setLoadingConcepts(false);
                }
                return;
              }
            } catch (e) {
              console.error("Failed parsing cloudMap:", e);
            }
          }
        }

        // If background RAG ingestion is actively processing this document, wait for polling hydration
        const activeStages = new Set(["queued", "extracting", "chunking", "embedding", "indexing", "summarizing"]);
        if (file.ragStage && activeStages.has(file.ragStage)) {
          return;
        }

        // Step 4: Fetch concepts from RAG-aware endpoint (uses cached vector index or ingests compact text)
        const inlineContent =
          file.content && !file.content.startsWith("/api/") && file.content.length < 300_000
            ? file.content
            : undefined;
        const response = await authFetch("/api/document/concepts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            fileType: file.type,
            fileContent: inlineContent,
          }),
        });

        if (!response.ok) {
          const errPayload = await response.json().catch(() => ({}));
          throw new Error(errPayload.error || "Failed to extract concepts from this file");
        }

        const data = await response.json();
        if (!cancelled && data && data.concepts) {
          setConcepts(data.concepts);
          if (data.concepts.length > 0) {
            setSelectedConcept(data.concepts[0]);
          }

          updateLocationCaches(data.concepts, data.overview);

          if (auth.currentUser) {
            const uid = auth.currentUser.uid;
            data.concepts.forEach((concept: any) => {
              saveTopicToFirestore(uid, {
                ...concept,
                uploadId: file.id,
                masteryScore: 0
              });
            });

            saveAchievementToFirestore(uid, "ach_first_upload", {
              title: "First Document Uploaded",
              description: `Uploaded and parsed your first focus study material: "${file.name}".`,
              unlockedAt: new Date().toISOString()
            });
          }
        }
      } catch (err: any) {
        console.error(err);
        if (!cancelled) {
          setErrorHeader(err.message || "An error occurred while analyzing the document.");
        }
      } finally {
        if (!cancelled) {
          setLoadingConcepts(false);
        }
      }
    }

    fetchConcepts();
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  // Voice Recording with actual SpeechRecognition and continuous updates
  const startVoiceRecording = () => {
    if (isVoiceActive) {
      // Stop recording
      shouldRecordRef.current = false;
      setIsVoiceActive(false);
      
      const speechText = currentSessionTranscriptRef.current.trim() || voiceTranscript.trim() || explanationText.trim() || "Spoken explanation note";
      const finalDuration = voiceDuration;

      if (speechIntervalRef.current) {
        clearInterval(speechIntervalRef.current);
        speechIntervalRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.error("Error stopping recognition:", e);
        }
        recognitionRef.current = null;
      }

      const voiceBlockId = Math.random().toString(36).substring(2, 11);

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.onstop = () => {
            try {
              const mimeType = mediaRecorderRef.current ? mediaRecorderRef.current.mimeType : 'audio/webm';
              const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
              const recordedUrl = URL.createObjectURL(audioBlob);
              if (recordedUrl) {
                setExplanationBlocks(prev => prev.map(block => 
                  block.id === voiceBlockId ? { ...block, audioUrl: recordedUrl } : block
                ));
              }
            } catch (err) {
              console.error("Error in MediaRecorder onstop:", err);
            }
          };
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.error("Error stopping media recorder:", e);
        }
      }

      if (audioStreamRef.current) {
        try {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
        } catch (e) {
          // ignore
        }
        audioStreamRef.current = null;
      }

      // Store the speech audio segment with the pre-determined voiceBlockId
      handleStoreVoiceBlock(speechText, finalDuration, voiceBlockId);
      return;
    }

    // Auto-save any already written draft as a permanent text block so it doesn't get merged or lost!
    if (explanationText.trim()) {
      handleStoreTextBlock();
    }

    initialExplanationTextRef.current = explanationText;
    currentSessionTranscriptRef.current = "";
    setVoiceTranscript("");

    shouldRecordRef.current = true;
    setIsVoiceActive(true);
    setVoiceDuration(0);

    // Initialize MediaRecorder for original audio capture
    audioChunksRef.current = [];
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        audioStreamRef.current = stream;
        let mediaRecorder;
        const options = { mimeType: 'audio/webm' };
        try {
          mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
          try {
            mediaRecorder = new MediaRecorder(stream);
          } catch (err) {
            console.error("MediaRecorder not supported or failed:", err);
            return;
          }
        }
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };
        mediaRecorder.start();
      })
      .catch((err) => {
        console.error("Error accessing microphone for recording audio:", err);
      });

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition is not supported on this browser.");
      return;
    }

    const runRecognition = () => {
      if (!shouldRecordRef.current) return;
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: any) => {
          let fullSessionTranscript = "";
          for (let i = 0; i < event.results.length; ++i) {
            fullSessionTranscript += event.results[i][0].transcript + " ";
          }
          const cleanTranscript = fullSessionTranscript.trim();
          if (cleanTranscript) {
            currentSessionTranscriptRef.current = cleanTranscript;
            setVoiceTranscript(cleanTranscript);
            
            // Sync with textarea so the user can see it there as well
            const prefix = initialExplanationTextRef.current;
            const separator = prefix && !prefix.endsWith(" ") ? " " : "";
            setExplanationText(prefix + separator + cleanTranscript);
          }
        };

        recognition.onerror = (event: any) => {
          console.error("Speech recognition error state:", event.error);
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            shouldRecordRef.current = false;
            setIsVoiceActive(false);
            if (speechIntervalRef.current) {
              clearInterval(speechIntervalRef.current);
              speechIntervalRef.current = null;
            }
          }
        };

        recognition.onend = () => {
          // If shouldRecordRef is still true, spawn a new instance to keep listening continuously without dropouts!
          if (shouldRecordRef.current) {
            setTimeout(() => {
              runRecognition();
            }, 300);
          } else {
            setIsVoiceActive(false);
            if (speechIntervalRef.current) {
              clearInterval(speechIntervalRef.current);
              speechIntervalRef.current = null;
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (err) {
        console.error("Failed to start SpeechRecognition:", err);
      }
    };

    runRecognition();

    if (speechIntervalRef.current) clearInterval(speechIntervalRef.current);
    speechIntervalRef.current = setInterval(() => {
      setVoiceDuration(prev => prev + 1);
    }, 1000);
  };

  // Canvas drawing handlers for Sketchpad feature
  const currentPointsRef = useRef<Array<{ x: number; y: number }>>([]);

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
  };

  // Keep canvas drawings in sync with strokes & responsive container resizes
  useEffect(() => {
    if (!isDrawingOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = width;
        canvas.height = height;
        redrawCanvas();
      }
    });

    resizeObserver.observe(parent);
    redrawCanvas();

    return () => {
      resizeObserver.disconnect();
    };
  }, [isDrawingOpen, strokes]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (drawingMode === "type") return;

    if (drawingMode === "eraser") {
      setIsDrawing(true);
      eraseAtPoint(x, y);
      return;
    }

    setIsDrawing(true);
    currentPointsRef.current = [{ x, y }];

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const eraseAtPoint = (x: number, y: number) => {
    setStrokes((prevStrokes) => {
      return prevStrokes.filter((stroke) => {
        return !stroke.points.some((p) => {
          const dx = p.x - x;
          const dy = p.y - y;
          return Math.sqrt(dx * dx + dy * dy) < 22; // 22px eraser radius
        });
      });
    });
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (drawingMode === "type") return;

    if (drawingMode === "eraser") {
      if (isDrawing) {
        eraseAtPoint(x, y);
      }
      return;
    }

    if (!isDrawing) return;
    currentPointsRef.current.push({ x, y });

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (drawingMode === "pen" && currentPointsRef.current.length > 0) {
      const newStroke: Stroke = {
        points: [...currentPointsRef.current],
        color: brushColor,
        width: brushWidth,
      };
      setStrokes((prev) => [...prev, newStroke]);
    }
    currentPointsRef.current = [];
  };

  const handleUndoStroke = () => {
    setStrokes((prev) => prev.slice(0, -1));
  };

  const clearCanvas = () => {
    setStrokes([]);
  };

  const getStrokesBoundingBox = (strokesList: Stroke[]) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    strokesList.forEach(stroke => {
      if (stroke.points) {
        stroke.points.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      }
    });

    if (minX === Infinity || maxX === -Infinity || minY === Infinity || maxY === -Infinity) {
      return { x: 0, y: 0, width: 400, height: 200 };
    }

    const padding = 15;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    let width = (maxX - minX) + (padding * 2);
    let height = (maxY - minY) + (padding * 2);

    if (width < 20) width = 20;
    if (height < 20) height = 20;

    return { x, y, width, height };
  };

  const convertStrokesToDataURL = (strokesList: Stroke[]): string | null => {
    if (!strokesList || strokesList.length === 0) return null;
    const box = getStrokesBoundingBox(strokesList);
    
    // Maintain speed and lower packet transmission size by constraining dimensions
    const MAX_DIMENSION = 256;
    let scale = 1;
    if (box.width > MAX_DIMENSION || box.height > MAX_DIMENSION) {
      scale = MAX_DIMENSION / Math.max(box.width, box.height);
    }

    const canvasWidth = Math.round(box.width * scale);
    const canvasHeight = Math.round(box.height * scale);

    // Create offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    
    // Match active canvas background so drawings stay high-contrast in both modes
    ctx.fillStyle = theme === "dark" ? "#080814" : "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    strokesList.forEach((stroke) => {
      if (!stroke.points || stroke.points.length < 1) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(1.5, stroke.width * scale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      
      const startPoint = stroke.points[0];
      ctx.moveTo((startPoint.x - box.x) * scale, (startPoint.y - box.y) * scale);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        ctx.lineTo((p.x - box.x) * scale, (p.y - box.y) * scale);
      }
      ctx.stroke();
    });
    
    try {
      // Export as a lightweight JPEG to minimize transmission overhead and accelerate grading
      return canvas.toDataURL("image/jpeg", 0.5);
    } catch (err) {
      console.error("Error creating image from strokes:", err);
      // Fallback to standard png if jpeg conversion fails
      try {
        return canvas.toDataURL("image/png");
      } catch (innerErr) {
        return null;
      }
    }
  };

  const handleStoreDrawingBlock = () => {
    if (strokes.length === 0) return;
    const newBlock: ExplanationBlock = {
      id: Math.random().toString(36).substring(2, 11),
      type: "drawing",
      content: "",
      strokes: [...strokes],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setExplanationBlocks(prev => [...prev, newBlock]);
    setStrokes([]);
  };

  const handleStoreTextBlock = () => {
    if (!explanationText.trim()) return;
    const newBlock: ExplanationBlock = {
      id: Math.random().toString(36).substring(2, 11),
      type: "text",
      content: explanationText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setExplanationBlocks(prev => [...prev, newBlock]);
    setExplanationText("");
  };

  const handleStoreVoiceBlock = (finalSpeechText: string, durationSecs: number, voiceBlockId?: string) => {
    const textContent = finalSpeechText.trim() || "Voice explanation note";
    const newBlock: ExplanationBlock = {
      id: voiceBlockId || Math.random().toString(36).substring(2, 11),
      type: "voice",
      content: textContent,
      duration: durationSecs || 1,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setExplanationBlocks(prev => [...prev, newBlock]);
    setExplanationText("");
  };

  const handleGradeExplanation = async () => {
    const compiledParts = [
      ...explanationBlocks.map(b => {
        if (b.type === "drawing") {
          return "[Student diagram attached. Grade the idea it expresses: parts, labels, and relationships. Ignore pixels, neatness, and visual similarity to any reference figure.]";
        }
        return b.content;
      }),
      explanationText.trim()
    ].filter(Boolean);

    if (strokes.length > 0) {
      compiledParts.push("[Student diagram attached. Grade the idea it expresses: parts, labels, and relationships. Ignore pixels, neatness, and visual similarity to any reference figure.]");
    }

    if (compiledParts.length === 0 || isGrading) return;
    const finalExplanation = compiledParts.join("\n\n");
    setIsGrading(true);
    setGradingError(null);

    const activeConceptTitle = selectedConcept ? selectedConcept.title : "Document Study";
    const activeConceptSummary = selectedConcept ? selectedConcept.summary : "Full context review";

    // Gather drawing images as base64 data URLs
    const listOfBase64Drawings: string[] = [];
    explanationBlocks.forEach(b => {
      if (b.type === "drawing" && b.strokes && b.strokes.length > 0) {
        const u = convertStrokesToDataURL(b.strokes);
        if (u) listOfBase64Drawings.push(u);
      }
    });

    if (strokes.length > 0) {
      const u = convertStrokesToDataURL(strokes);
      if (u) listOfBase64Drawings.push(u);
    }

    const inlineOriginalContent =
      file.content && !file.content.startsWith("/api/") && file.content.length < 300_000
        ? file.content
        : undefined;

    try {
      const response = await authFetch("/api/feynman/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          fileName: file.name,
          conceptTitle: activeConceptTitle,
          conceptSummary: activeConceptSummary,
          userExplanation: finalExplanation,
          originalContent: inlineOriginalContent,
          fileType: file.type,
          previousChat: [],
          userDrawings: listOfBase64Drawings
        }),
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || "Unable to evaluate your explanation right now.");
      }

      const evalData = await response.json();
      
      // Update scorecard cache
      const conceptKey = selectedConcept ? selectedConcept.title : "global";
      setScoreCards(prev => ({
        ...prev,
        [conceptKey]: {
          clarity: evalData.clarity ?? evalData.accuracy ?? 80,
          accuracy: evalData.accuracy ?? 80,
          simplicity: evalData.simplicity ?? 80,
          completeness: evalData.completeness ?? 80,
          gaps: Array.isArray(evalData.gaps) ? evalData.gaps : [],
          suggestions: evalData.suggestions || "Focus on tying key mechanisms to a concrete real-world example.",
          feedbackText: evalData.feedbackText || "Great explanation! How would you test whether someone truly understood this idea?",
          diagramUnderstanding: typeof evalData.diagramUnderstanding === "string" ? evalData.diagramUnderstanding : "",
          citations: Array.isArray(evalData.citations) ? evalData.citations : [],
          retrievalLatencyMs: evalData.retrievalLatencyMs,
        }
      }));

      // Add a dynamic action record to studyLog
      const newScore = Math.round(
        (Number(evalData.simplicity || 85) + Number(evalData.completeness || 92) + Number(evalData.accuracy || 88)) / 3
      );
      const newLog = {
        date: new Date().toISOString().split("T")[0],
        concept: conceptKey,
        score: newScore
      };
      
      let activeStreak = 1;
      setStudyLog(prev => {
        const next = [newLog, ...prev];
        localStorage.setItem("feynman_study_log", JSON.stringify(next));
        
        // Calculate Streak
        const uniqueDates = Array.from(new Set(next.map(item => item.date))).sort().reverse();
        let streakCount = 1;
        const getMidnightTime = (dateStr: string) => {
          const parts = dateStr.split('-');
          if (parts.length === 3) {
            return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime();
          }
          return new Date(dateStr).getTime();
        };

        if (uniqueDates.length > 1) {
          let currentRefTime = getMidnightTime(uniqueDates[0]);
          for (let i = 1; i < uniqueDates.length; i++) {
            const prevTime = getMidnightTime(uniqueDates[i]);
            const diffDays = Math.round((currentRefTime - prevTime) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
              streakCount++;
              currentRefTime = prevTime;
            } else if (diffDays > 1) {
              break;
            }
          }
        }
        activeStreak = streakCount;
        return next;
      });

      // Synchronize stats and subcollections to Firestore if authenticated
      if (auth.currentUser) {
        const uid = auth.currentUser.uid;
        const explanationId = "explanation_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const feedbackId = "feedback_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

        // Gather metrics
        const clarityScore = evalData.clarity || 90;
        const accuracyScore = evalData.accuracy !== undefined ? evalData.accuracy : 88;
        const simplicityScore = evalData.simplicity !== undefined ? evalData.simplicity : 85;
        const completenessScore = evalData.completeness !== undefined ? evalData.completeness : 92;
        const feedbackGaps = evalData.gaps && evalData.gaps.length > 0 ? evalData.gaps : [
          "The connection between theoretical concepts and real-world applications can be further illustrated with physical analogies"
        ];
        const suggestionsText = evalData.suggestions || "Try explaining using simpler metaphors.";
        const feynmanFeedback = evalData.feedbackText || "Your explanation was a great start!";

                // 1. Save explanation document under explanations subcollection
        saveExplanationToFirestore(uid, explanationId, {
          conceptTitle: activeConceptTitle,
          userExplanation: finalExplanation,
          score: newScore,
          clarity: Number(clarityScore),
          accuracy: Number(accuracyScore),
          simplicity: Number(simplicityScore),
          completeness: Number(completenessScore),
          uploadId: file.id,
          topicId: selectedConcept?.id || "global_topic"
        });

        // 2. Save feedback document under feedback subcollection
        saveFeedbackToFirestore(uid, feedbackId, {
          explanationId: explanationId,
          conceptTitle: activeConceptTitle,
          suggestions: suggestionsText,
          feedbackText: feynmanFeedback,
          gaps: feedbackGaps,
          uploadId: file.id,
          topicId: selectedConcept?.id || "global_topic"
        });

        // 3. Save topic mastery under topics subcollection
        if (selectedConcept) {
          saveTopicToFirestore(uid, {
            ...selectedConcept,
            uploadId: file.id,
            masteryScore: newScore,
            latestExplanation: finalExplanation,
            latestFeedback: feynmanFeedback
          });
        }

        // 4. Update achievements subcollection
        saveAchievementToFirestore(uid, "ach_first_explain", {
          title: "Initial Breakthrough",
          description: "Graded your very first study explanation using the Feynman technique.",
          unlockedAt: new Date().toISOString()
        });
        
        if (newScore >= 80) {
          saveAchievementToFirestore(uid, "ach_mastery", {
            title: "Concept Master",
            description: `Scored an impressive ${newScore}% mastery on the topic of "${activeConceptTitle}".`,
            unlockedAt: new Date().toISOString()
          });
        }
        
        if (newScore >= 95) {
          saveAchievementToFirestore(uid, "ach_full_marks", {
            title: "Perfect Alignment",
            description: `Attained elite and comprehensive understanding of "${activeConceptTitle}" with ${newScore}%.`,
            unlockedAt: new Date().toISOString()
          });
        }

        // 5. Update user profile statistics with streak, avgMastery, topicsMastered
        getUserProfile(uid).then((prof) => {
          if (prof) {
            const masteredIncrement = newScore >= 80 ? 1 : 0;
            const updatedTopicsMastered = prof.totalTopicsMastered + masteredIncrement;
            const streakCount = activeStreak;

            const updatedStats = {
              totalTopicsMastered: updatedTopicsMastered,
              topicsMastered: updatedTopicsMastered,
              avgMastery: Math.min(100, Math.round(((prof.avgMastery || 85) + newScore) / 2)),
              streak: streakCount
            };

            updateUserProfileStats(uid, updatedStats);
            setUserProfile(prevProf => prevProf ? { 
              ...prevProf, 
              ...updatedStats 
            } : null);
          }
        });
      }

      // Directly auto transition to Feedback Tab!
      setActiveTab("feedback");

    } catch (err: any) {
      console.error("Evaluation failed:", err);
      setGradingError(err?.message || "Failed to evaluate your explanation. Please check your connection and try again.");
    } finally {
      setIsGrading(false);
    }
  };

  const handleClearText = () => {
    setExplanationText("");
  };

  const currentConceptKey = selectedConcept ? selectedConcept.title : "global";
  const currentScoreCard = scoreCards[currentConceptKey];

  const computedGrade = currentScoreCard
    ? Math.round((Number(currentScoreCard.simplicity || 0) + Number(currentScoreCard.completeness || 0) + Number(currentScoreCard.accuracy || 0)) / 3)
    : null;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#FAFAFC] dark:bg-[#070711] text-slate-900 dark:text-slate-100 border-l border-slate-200/80 dark:border-white/[0.07] transition-colors duration-200" id="feynman-premium-arena">
      
      {/* 1. Header Navigation Bar */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 dark:border-white/[0.07] bg-white/90 dark:bg-[#070711]/90 backdrop-blur-md px-5 md:px-7 py-3.5 z-10 shrink-0" id="arena-header">
        
        {/* Left Aligned: Logo & Subtitled Filename */}
        <div className="flex flex-col select-none min-w-0" id="arena-brand-group">
          <div className="flex items-center gap-2">
            {isSidebarCollapsed && onToggleSidebar && (
              <button 
                id="btn-arena-reopen-sidebar"
                onClick={onToggleSidebar}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-white/[0.08] transition-all flex items-center justify-center cursor-pointer select-none focus:outline-none shrink-0"
                title="Open Recent Uploads sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <button 
              id="btn-arena-back-dash"
              onClick={onBack}
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-all cursor-pointer shrink-0"
              title="Return to home"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onBack}
              className="text-lg md:text-xl font-extrabold tracking-[0.18em] text-slate-900 dark:text-white hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer text-left focus:outline-none whitespace-nowrap"
              title="Return to home page"
            >
              FEYNMAN
            </button>
          </div>
          <button 
            id="btn-view-source"
            onClick={() => setIsSourceDocumentOpen(true)}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-300 font-medium mt-0.5 ml-8 flex items-center gap-1.5 hover:underline transition-all cursor-pointer text-left focus:outline-none max-w-[200px] md:max-w-[320px]"
            title={`Click to view uploaded file: ${file.name}`}
          >
            <span className="truncate">{file.name}</span>
            <BookOpen className="w-3 h-3 text-violet-600 dark:text-violet-400 shrink-0" />
          </button>
        </div>

        {/* Center / Right Aligned Nav Group + Theme Toggle */}
        <div className="flex items-center gap-3 md:gap-4 shrink-0" id="arena-header-controls">
          <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar" id="arena-tabs">
            
            {/* Explain it Tab */}
            <button
              id="tab-toggle-explain"
              onClick={() => setActiveTab("explain")}
              className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "explain"
                  ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
              }`}
            >
              Explain it
            </button>

            {/* Feedback Tab */}
            <button
              id="tab-toggle-feedback"
              onClick={() => setActiveTab("feedback")}
              className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === "feedback"
                  ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
              }`}
            >
              Feedback {computedGrade !== null && `(${computedGrade}%)`}
            </button>

            {/* Knowledge Map Tab */}
            <button
              id="tab-toggle-map"
              onClick={() => setActiveTab("map")}
              className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "map"
                  ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
              }`}
            >
              Knowledge Map
            </button>

            {/* Sources Tab */}
            <button
              id="tab-toggle-sources"
              onClick={() => setActiveTab("sources")}
              className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "sources"
                  ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
              }`}
            >
              Sources
            </button>

            {/* Progress Tab */}
            <button
              id="tab-toggle-progress"
              onClick={() => setActiveTab("progress")}
              className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "progress"
                  ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
              }`}
            >
              Progress
            </button>

          </nav>

          <ThemeToggle compact />
        </div>
      </div>

      {/* Non-blocking RAG Ingestion Progress Bar (only while indexing or on error) */}
      {file.ragStage && file.ragStage !== "ready" && (
        <div
          className={`px-5 md:px-7 py-2 border-b text-xs flex items-center justify-between gap-4 shrink-0 ${
            file.ragStage === "error"
              ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300"
              : "bg-violet-50/70 dark:bg-violet-950/20 border-violet-200/70 dark:border-violet-500/20 text-violet-700 dark:text-violet-300"
          }`}
          id="rag-ingestion-banner"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {file.ragStage === "error" ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
            )}
            <span className="font-semibold capitalize shrink-0">{file.ragStage}:</span>
            <span className="truncate">
              {file.ragStage === "error"
                ? file.ragError || "Document indexing encountered an error."
                : file.ragMessage || "Indexing document sections and embeddings..."}
            </span>
          </div>
          {file.ragStage !== "error" && (
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-24 h-1.5 rounded-full bg-violet-200/70 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-violet-600 dark:bg-violet-400 transition-all duration-300"
                  style={{ width: `${Math.max(8, Math.min(100, file.ragProgress ?? 15))}%` }}
                />
              </div>
              <span className="font-mono text-[11px] font-semibold tabular-nums">
                {file.ragProgress ?? 15}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Primary Workspace Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 flex flex-col justify-between" id="arena-main-scroll">
        
        <AnimatePresence mode="wait">
          
          {/* TAB 1: EXPLAIN IT VIEW */}
          {activeTab === "explain" && (
            <motion.div
              key="explain-view"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col space-y-6"
              id="explain-box-container"
            >
              
              {/* Target Prompt Box + Concept Selector */}
              <div className="space-y-3">
                <div 
                  className="w-full rounded-xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] px-4 py-3 flex items-center justify-between shadow-xs" 
                  id="audience-prompt-box"
                >
                  <div className="flex items-center space-x-3 w-full pr-4" id="target-audience">
                    <BrainCircuit className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                    <input
                      type="text"
                      id="input-prompt-guide"
                      value={promptGuide}
                      onChange={(e) => setPromptGuide(e.target.value)}
                      className="bg-transparent text-slate-800 dark:text-slate-200 text-xs md:text-sm font-medium focus:outline-none w-full placeholder-slate-400 dark:placeholder-slate-500"
                      placeholder="Enter target explanation audience..."
                    />
                  </div>
                  <span className="text-[10px] font-mono font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-widest hidden md:inline whitespace-nowrap shrink-0">
                    Feynman Persona
                  </span>
                </div>

                {concepts.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                      Topic focus:
                    </span>
                    {concepts.map((c) => {
                      const isActive = selectedConcept?.id === c.id;
                      const isGraded = !!scoreCards[c.title];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedConcept(c)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
                            isActive
                              ? "bg-violet-600 text-white border-violet-600 shadow-xs"
                              : "bg-white dark:bg-white/[0.04] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-violet-300 dark:hover:border-violet-500/40"
                          }`}
                        >
                          <span>{c.title}</span>
                          {isGraded && (
                            <Check className={`w-3 h-3 ${isActive ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-400"}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Saved Explanation Blocks Timeline (Shows sequentially under typed text) */}
              {explanationBlocks.length > 0 && (
                <div className="flex flex-col space-y-3 p-4 rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] shadow-xs" id="explanation-blocks-timeline">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                      Explanation Segments ({explanationBlocks.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (currentlyPlayingBlockId) {
                          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                          if (activeAudioRef.current) {
                            try {
                              activeAudioRef.current.pause();
                              activeAudioRef.current = null;
                            } catch (e) {}
                          }
                          setCurrentlyPlayingBlockId(null);
                        }
                        setExplanationBlocks([]);
                      }}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer select-none"
                    >
                      Clear all segments
                    </button>
                  </div>
                  
                  <div className="flex flex-col space-y-3 max-h-[280px] overflow-y-auto pr-1">
                    {explanationBlocks.map((block) => (
                      <div 
                        key={block.id}
                        className={`flex items-start justify-between p-4 rounded-xl border transition-all duration-200 relative group/block ${
                          block.type === "voice" 
                            ? "bg-rose-50/60 dark:bg-rose-950/15 border-rose-200/80 dark:border-rose-500/20" 
                            : block.type === "drawing"
                              ? "bg-sky-50/60 dark:bg-[#081022] border-sky-200/80 dark:border-cyan-500/20"
                              : "bg-slate-50/80 dark:bg-white/[0.03] border-slate-200/80 dark:border-white/[0.08]"
                        }`}
                      >
                        <div className="flex items-start space-x-3 w-full pr-8">
                          <div className={`mt-0.5 p-2 rounded-lg shrink-0 ${
                            block.type === "voice" 
                              ? "bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400" 
                              : block.type === "drawing"
                                ? "bg-sky-100 dark:bg-cyan-500/15 text-sky-600 dark:text-cyan-400"
                                : "bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400"
                          }`}>
                            {block.type === "voice" ? (
                              <Mic className="w-4 h-4" />
                            ) : block.type === "drawing" ? (
                              <Pencil className="w-4 h-4" />
                            ) : (
                              <BookOpen className="w-4 h-4" />
                            )}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1.5 flex-wrap gap-y-1">
                              <span className={`text-[11px] uppercase tracking-wider font-semibold ${
                                block.type === "voice" 
                                  ? "text-rose-700 dark:text-rose-400" 
                                  : block.type === "drawing"
                                    ? "text-sky-700 dark:text-cyan-400"
                                    : "text-violet-700 dark:text-violet-400"
                              }`}>
                                {block.type === "voice" ? "Voice Note" : block.type === "drawing" ? "Whiteboard Diagram" : "Written Note"}
                              </span>
                              <span className="text-slate-400 dark:text-slate-600 text-[10px]">·</span>
                              <span className="text-slate-500 font-mono text-[11px] tabular-nums">{block.timestamp}</span>
                              {block.type === "voice" && block.duration !== undefined && (
                                <>
                                  <span className="text-slate-400 dark:text-slate-600 text-[10px]">·</span>
                                  <span className="text-rose-700 dark:text-rose-300 text-[11px] font-mono font-semibold tabular-nums">
                                    {Math.floor(block.duration / 60)}:{(block.duration % 60).toString().padStart(2, "0")}
                                  </span>
                                </>
                              )}
                            </div>

                            {block.type === "voice" ? (
                              <div className="space-y-2.5">
                                {/* Visual Audio Waveform block */}
                                <div className="flex items-center space-x-3.5 bg-white dark:bg-rose-950/25 border border-rose-200 dark:border-rose-500/25 rounded-xl p-3 w-full max-w-xs sm:max-w-md">
                                  <button
                                    onClick={() => {
                                      if (currentlyPlayingBlockId === block.id) {
                                        setCurrentlyPlayingBlockId(null);
                                        if (activeAudioRef.current) {
                                          try {
                                            activeAudioRef.current.pause();
                                            activeAudioRef.current = null;
                                          } catch (e) {
                                            // ignore
                                          }
                                        }
                                        if ('speechSynthesis' in window) {
                                          try {
                                            window.speechSynthesis.cancel();
                                          } catch (e) {
                                            // ignore
                                          }
                                        }
                                      } else {
                                        // Stop any current playbacks
                                        if (activeAudioRef.current) {
                                          try {
                                            activeAudioRef.current.pause();
                                            activeAudioRef.current = null;
                                          } catch (e) {
                                            // ignore
                                          }
                                        }
                                        if ('speechSynthesis' in window) {
                                          try {
                                            window.speechSynthesis.cancel();
                                          } catch (e) {
                                            // ignore
                                          }
                                        }

                                        setCurrentlyPlayingBlockId(block.id);

                                        if (block.audioUrl) {
                                          const audio = new Audio(block.audioUrl);
                                          activeAudioRef.current = audio;
                                          audio.onended = () => {
                                            setCurrentlyPlayingBlockId(null);
                                            if (activeAudioRef.current === audio) {
                                              activeAudioRef.current = null;
                                            }
                                          };
                                          audio.onerror = () => {
                                            console.warn("Error playing recorded original audio, falling back to speech synthesis");
                                            if ('speechSynthesis' in window) {
                                              const utterance = new SpeechSynthesisUtterance(block.content);
                                              utterance.onend = () => setCurrentlyPlayingBlockId(null);
                                              utterance.onerror = () => setCurrentlyPlayingBlockId(null);
                                              window.speechSynthesis.speak(utterance);
                                            } else {
                                              setCurrentlyPlayingBlockId(null);
                                            }
                                          };
                                          audio.play().catch(err => {
                                            console.warn("Failed to play audio, using fallback speech synthesis:", err);
                                            if ('speechSynthesis' in window) {
                                              const utterance = new SpeechSynthesisUtterance(block.content);
                                              utterance.onend = () => setCurrentlyPlayingBlockId(null);
                                              utterance.onerror = () => setCurrentlyPlayingBlockId(null);
                                              window.speechSynthesis.speak(utterance);
                                            } else {
                                              setCurrentlyPlayingBlockId(null);
                                            }
                                          });
                                        } else {
                                          // Fallback to text to speech if no original recorded audio is present
                                          if ('speechSynthesis' in window) {
                                            const utterance = new SpeechSynthesisUtterance(block.content);
                                            utterance.onend = () => {
                                              setCurrentlyPlayingBlockId(null);
                                            };
                                            utterance.onerror = () => {
                                              setCurrentlyPlayingBlockId(null);
                                            };
                                            window.speechSynthesis.speak(utterance);
                                          } else {
                                            // playback state auto reset fallback
                                            setTimeout(() => {
                                              setCurrentlyPlayingBlockId(null);
                                            }, (block.duration || 3) * 1000);
                                          }
                                        }
                                      }
                                    }}
                                    className="w-9 h-9 rounded-full bg-rose-100 dark:bg-rose-500/20 hover:bg-rose-600 text-rose-700 dark:text-rose-200 hover:text-white transition-all duration-200 flex items-center justify-center shrink-0 cursor-pointer border border-rose-200 dark:border-rose-500/30"
                                    title={currentlyPlayingBlockId === block.id ? "Stop Listening" : "Listen to audio message playback"}
                                  >
                                    {currentlyPlayingBlockId === block.id ? (
                                      <Square className="w-3.5 h-3.5" />
                                    ) : (
                                      <Play className="w-3.5 h-3.5 ml-0.5" />
                                    )}
                                  </button>
                                  
                                  <div className="flex-1 flex flex-col justify-center min-w-0">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-1">
                                      {block.audioUrl ? "Original Voice Recording" : "Voice Transcript Playback"}
                                    </div>
                                    <div className="flex items-center space-x-[2px] h-5 flex-1">
                                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((idx) => {
                                        const baseHeight = 30 + Math.sin(idx * 0.5) * 20 + (idx % 3) * 10;
                                        return (
                                          <span 
                                            key={idx} 
                                            className={`w-[2.5px] rounded-full transition-all duration-300 ${
                                              currentlyPlayingBlockId === block.id 
                                                ? "bg-rose-500 h-[80%] animate-pulse" 
                                                : "bg-rose-300 dark:bg-rose-500/35"
                                            }`}
                                            style={{ 
                                              height: currentlyPlayingBlockId === block.id ? undefined : `${baseHeight}%`
                                            }}
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Transcript content */}
                                <p className="text-slate-700 dark:text-slate-300 text-xs md:text-sm italic leading-relaxed font-medium">
                                  "{block.content}"
                                </p>
                              </div>
                            ) : block.type === "drawing" ? (
                              <div className="space-y-1 w-full max-w-full overflow-hidden">
                                {block.strokes && block.strokes.length > 0 ? (
                                  (() => {
                                    const box = getStrokesBoundingBox(block.strokes);
                                    return (
                                      <div className="bg-white dark:bg-[#080814] p-2.5 rounded-lg border border-slate-200 dark:border-white/[0.08] mt-1 w-full max-w-lg overflow-hidden">
                                        <svg 
                                          viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
                                          className="w-full max-h-[160px] h-auto object-contain"
                                        >
                                          {block.strokes.map((stroke, sIdx) => {
                                            if (!stroke.points || stroke.points.length === 0) return null;
                                            if (stroke.points.length === 1) {
                                              return (
                                                <circle 
                                                  key={sIdx} 
                                                  cx={stroke.points[0].x} 
                                                  cy={stroke.points[0].y} 
                                                  r={stroke.width / 2} 
                                                  fill={stroke.color} 
                                                />
                                              );
                                            }
                                            const dPath = stroke.points.reduce((acc, p, pIdx) => {
                                              return acc + (pIdx === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
                                            }, "");
                                            return (
                                              <path 
                                                key={sIdx} 
                                                d={dPath} 
                                                stroke={stroke.color} 
                                                strokeWidth={stroke.width} 
                                                strokeLinecap="round" 
                                                strokeLinejoin="round" 
                                                fill="none" 
                                              />
                                            );
                                          })}
                                        </svg>
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <p className="text-slate-500 text-xs italic">Blank whiteboard drawing</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-slate-700 dark:text-slate-200 text-xs md:text-sm leading-relaxed whitespace-pre-wrap">
                                {block.content}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Delete individual block */}
                        <button
                          onClick={() => {
                            if (currentlyPlayingBlockId === block.id) {
                              setCurrentlyPlayingBlockId(null);
                              if ('speechSynthesis' in window) {
                                window.speechSynthesis.cancel();
                              }
                            }
                            setExplanationBlocks(prev => prev.filter(b => b.id !== block.id));
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg absolute right-3 top-3 opacity-0 group-hover/block:opacity-100 transition-opacity cursor-pointer focus:opacity-100"
                          title="Delete Segment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Text Explanation Canvas Box */}
              <div 
                className="flex-1 rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] flex flex-col justify-between p-6 relative group min-h-[380px] shadow-xs" 
                id="explanation-canvas-container"
              >
                {isGrading ? (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-4" id="grading-spinner">
                    <div className="w-10 h-10 border-4 border-violet-600 dark:border-violet-400 border-t-transparent rounded-full animate-spin" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Analyzing explanation...</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Checking simplicity metrics and semantic gaps</p>
                  </div>
                ) : (
                  <>
                    {/* Integrated Transparent Draw whiteboard canvas overlay */}
                    {isDrawingOpen && (
                      <canvas
                        ref={canvasRef}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        className={`absolute left-0 top-0 right-0 bottom-16 w-full h-[calc(100%-64px)] bg-transparent z-10 transition-all ${
                          drawingMode === "type" 
                            ? "pointer-events-none cursor-text" 
                            : "pointer-events-auto cursor-crosshair"
                        }`}
                        id="teacher-whiteboard-overlay-canvas"
                      />
                    )}

                    {/* Floating Whiteboard Toolbar */}
                    {isDrawingOpen && (
                      <div 
                        className="absolute top-4 right-4 z-20 flex flex-wrap items-center gap-2 bg-white/95 dark:bg-[#0E0E1D]/95 border border-slate-200 dark:border-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-md select-none"
                        id="whiteboard-floating-toolbar"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 px-1 hidden sm:inline">
                          Whiteboard
                        </span>

                        {/* Mode Selectors */}
                        <div className="flex bg-slate-100 dark:bg-white/[0.05] p-0.5 rounded-lg border border-slate-200/80 dark:border-white/[0.07] gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setDrawingMode("type")}
                            className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                              drawingMode === "type" 
                                ? "bg-white dark:bg-violet-500/20 text-violet-700 dark:text-violet-200 shadow-xs" 
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                            title="Keyboard Type (Cursor is free to type text beneath drawings)"
                          >
                            <MousePointer className="w-3 h-3" />
                            <span>Type</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDrawingMode("pen")}
                            className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                              drawingMode === "pen" 
                                ? "bg-white dark:bg-violet-500/25 text-violet-700 dark:text-violet-200 shadow-xs" 
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                            title="Pen Sketch (Draw freehand over your texts)"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Draw</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDrawingMode("eraser")}
                            className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                              drawingMode === "eraser" 
                                ? "bg-white dark:bg-violet-500/20 text-violet-700 dark:text-violet-200 shadow-xs" 
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                            title="Eraser tool"
                          >
                            <Eraser className="w-3 h-3" />
                            <span>Eraser</span>
                          </button>
                        </div>

                        {/* Color preset selection */}
                        {drawingMode === "pen" && (
                          <>
                            <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">|</span>
                            <div className="flex items-center gap-1.5 px-1 shrink-0">
                              {[
                                { hex: "#d946ef", label: "Violet Marker" },
                                { hex: "#06b6d4", label: "Cyan Marker" },
                                { hex: "#10b981", label: "Emerald Marker" },
                                { hex: "#ef4444", label: "Coral Marker" }
                              ].map((item) => (
                                <button
                                  key={item.hex}
                                  type="button"
                                  onClick={() => setBrushColor(item.hex)}
                                  className="w-4 h-4 rounded-full border border-slate-300 dark:border-white/20 transition-transform hover:scale-110 cursor-pointer relative flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: item.hex }}
                                  title={item.label}
                                >
                                  {brushColor === item.hex && (
                                    <span className="w-1.5 h-1.5 bg-white rounded-full shadow-xs" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        {/* Brush Width Selector */}
                        {drawingMode === "pen" && (
                          <>
                            <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">|</span>
                            <div className="flex bg-slate-100 dark:bg-white/[0.05] p-0.5 rounded-lg gap-0.5 border border-slate-200/80 dark:border-white/[0.07] shrink-0">
                              {[
                                { size: 2, label: "Thin" },
                                { size: 4, label: "Mid" },
                                { size: 8, label: "Thick" }
                              ].map((pixelSize) => (
                                <button
                                  key={pixelSize.size}
                                  type="button"
                                  onClick={() => setBrushWidth(pixelSize.size)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                    brushWidth === pixelSize.size 
                                      ? "bg-white dark:bg-violet-500/25 text-violet-700 dark:text-violet-200 shadow-xs" 
                                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                                  }`}
                                  title={`${pixelSize.label} brush stroke width`}
                                >
                                  {pixelSize.label}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        <span className="text-slate-300 dark:text-slate-700">|</span>

                        {/* Quick Undo and Wipes */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={handleUndoStroke}
                            disabled={strokes.length === 0}
                            className="p-1.5 rounded-md bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                            title="Undo drawing stroke"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={clearCanvas}
                            disabled={strokes.length === 0}
                            className="p-1.5 rounded-md bg-slate-100 dark:bg-white/[0.05] hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                            title="Wipe whiteboard markings clean"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={handleStoreDrawingBlock}
                            disabled={strokes.length === 0}
                            className="bg-sky-50 dark:bg-cyan-500/15 hover:bg-sky-100 dark:hover:bg-cyan-500/25 border border-sky-200 dark:border-cyan-500/30 text-sky-700 dark:text-cyan-200 disabled:opacity-30 disabled:pointer-events-none px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer select-none whitespace-nowrap"
                            title="Save whiteboard drawing to permanent segments"
                          >
                            <span>+ Save Drawing</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setIsDrawingOpen(false);
                              setDrawingMode("type");
                            }}
                            className="p-1.5 rounded-md bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                            title="Collapse whiteboards"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}

                    <textarea
                      id="text-explanation"
                      value={explanationText}
                      onChange={(e) => setExplanationText(e.target.value)}
                      placeholder={isDrawingOpen || strokes.length > 0 || explanationBlocks.some(b => b.type === "drawing") ? "" : "Start explaining the concept in your own words. Click Draw to open the whiteboard overlay, or Voice to speak your explanation..."}
                      className="w-full flex-1 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm md:text-base leading-relaxed focus:outline-none resize-none min-h-[300px] pt-12"
                    />

                    {/* Integrated Voice active bar */}
                    <AnimatePresence>
                      {isVoiceActive && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="mb-4 p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/30 rounded-xl flex items-center justify-between"
                          id="voice-active-bar"
                        >
                          <div className="flex items-center space-x-3">
                            <span className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                            </span>
                            <div className="flex flex-col">
                              <span className="text-xs text-rose-800 dark:text-rose-200 font-semibold flex items-center gap-2">
                                Listening... Speak clearly
                                <span className="flex items-center gap-[1.5px] h-3">
                                  <span className="w-[1.5px] h-1.5 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '0.6s' }} />
                                  <span className="w-[1.5px] h-3 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '0.6s' }} />
                                  <span className="w-[1.5px] h-1 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '0.6s' }} />
                                  <span className="w-[1.5px] h-2 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '450ms', animationDuration: '0.6s' }} />
                                </span>
                              </span>
                              <span className="text-[11px] text-rose-600/80 dark:text-slate-400 font-mono tabular-nums">
                                Duration: {Math.floor(voiceDuration / 60)}:{(voiceDuration % 60).toString().padStart(2, "0")}
                              </span>
                              {voiceTranscript && (
                                <p className="text-xs text-rose-700 dark:text-rose-300/90 italic mt-1 max-w-xs sm:max-w-md line-clamp-2">
                                  "{voiceTranscript}"
                                </p>
                              )}
                            </div>
                          </div>
                          <button
                            id="btn-voice-stop"
                            onClick={startVoiceRecording}
                            className="bg-rose-600 hover:bg-rose-700 text-white rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                          >
                            Finish
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {gradingError && (
                      <div className="mb-3 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{gradingError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setGradingError(null)}
                          className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-200 cursor-pointer shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Action Bar inside textarea box */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 dark:border-white/[0.07] pt-4 mt-2 shrink-0" id="explanation-canvas-actions">
                      {/* Left: Input helper triggers */}
                      <div className="flex items-center gap-2 flex-wrap" id="helper-triggers-left">
                        
                        {/* Voice button */}
                        <button
                          id="btn-trigger-voice"
                          onClick={startVoiceRecording}
                          type="button"
                          className={`flex items-center space-x-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                            isVoiceActive 
                              ? "bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/40" 
                              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.05] border border-transparent"
                          }`}
                        >
                          <Mic className={`w-4 h-4 ${isVoiceActive ? "text-rose-500 animate-pulse" : ""}`} />
                          <span className="flex items-center gap-1.5">
                            {isVoiceActive ? "Listening..." : "Voice"}
                            {isVoiceActive && (
                              <span className="flex items-center gap-[1.5px] h-3 ml-0.5">
                                <span className="w-[1.5px] h-1.5 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '0.6s' }} />
                                <span className="w-[1.5px] h-2.5 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '0.6s' }} />
                                <span className="w-[1.5px] h-1 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '0.6s' }} />
                                <span className="w-[1.5px] h-2 bg-rose-500 rounded-full animate-bounce" style={{ animationDelay: '450ms', animationDuration: '0.6s' }} />
                              </span>
                            )}
                          </span>
                        </button>

                        {/* Draw button */}
                        <button
                          id="btn-trigger-draw"
                          onClick={() => {
                            const nextState = !isDrawingOpen;
                            setIsDrawingOpen(nextState);
                            setDrawingMode(nextState ? "pen" : "type");
                          }}
                          type="button"
                          className={`flex items-center space-x-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                            isDrawingOpen 
                              ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-500/30" 
                              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.05] border border-transparent"
                          }`}
                        >
                          <Pencil className="w-4 h-4" />
                          <span>Draw</span>
                        </button>

                        {isDrawingOpen && strokes.length > 0 && (
                          <button
                            id="btn-store-drawing"
                            onClick={handleStoreDrawingBlock}
                            type="button"
                            className="flex items-center space-x-1 py-1.5 px-3 bg-sky-50 dark:bg-cyan-500/10 border border-sky-200 dark:border-cyan-500/30 text-sky-700 dark:text-cyan-300 hover:bg-sky-100 dark:hover:bg-cyan-500/20 rounded-lg text-xs font-semibold cursor-pointer select-none transition-all whitespace-nowrap shrink-0"
                            title="Save the active whiteboard sketch as a dynamic segment block"
                          >
                            <span>+ Save Drawing</span>
                          </button>
                        )}

                        {/* Store segment button */}
                        {explanationText.trim() && !isVoiceActive && (
                          <button
                            id="btn-store-written-block"
                            onClick={handleStoreTextBlock}
                            type="button"
                            className="flex items-center space-x-1 py-1.5 px-3 bg-violet-50 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/25 rounded-lg text-xs font-semibold cursor-pointer select-none transition-all whitespace-nowrap shrink-0"
                            title="Store written draft as a sequential segment block"
                          >
                            <span>+ Store segment</span>
                          </button>
                        )}
                      </div>

                      {/* Right: Clear & Grade Action buttons */}
                      <div className="flex items-center space-x-3" id="evaluation-triggers-right">
                        
                        {/* Clear button */}
                        <button
                          id="btn-trigger-clear"
                          onClick={handleClearText}
                          type="button"
                          className="flex items-center space-x-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-all cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Clear</span>
                        </button>

                        {/* Grade it button */}
                        <motion.button
                          id="btn-trigger-grade"
                          onClick={handleGradeExplanation}
                          disabled={((explanationBlocks.length === 0 && !explanationText.trim()) || isGrading)}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          className="py-2.5 px-6 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-white/[0.06] text-white disabled:text-slate-400 dark:disabled:text-slate-500 shadow-xs transition-all text-xs font-semibold flex items-center space-x-2 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Grade it</span>
                        </motion.button>
                      </div>

                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 2: DETAILED FEEDBACK DASHBOARD */}
          {activeTab === "feedback" && (() => {
            if (!currentScoreCard) {
              return (
                <motion.div
                  key="feedback-empty-view"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.25 }}
                  className="max-w-4xl mx-auto w-full flex-1 flex flex-col items-center justify-center text-center p-12 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl min-h-[400px] shadow-xs"
                  id="empty-feedback"
                >
                  <div className="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-500/15 border border-violet-200/80 dark:border-violet-500/25 flex items-center justify-center mb-4">
                    <Award className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">No grading scorecard generated yet</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mt-2 leading-relaxed">
                    You have not yet graded your explanation for <span className="text-violet-600 dark:text-violet-400 font-semibold">"{selectedConcept?.title || "this concept"}"</span>. Teach Feynman in the "Explain it" tab, then click "Grade it" to view your scorecard.
                  </p>
                  <button
                    id="btn-empty-explain-redirect"
                    onClick={() => setActiveTab("explain")}
                    className="mt-6 px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white transition-all text-xs font-semibold flex items-center space-x-2 cursor-pointer shadow-xs"
                  >
                    <span>Start Teaching Now</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              );
            }

            const activeScoreCard = currentScoreCard;
            const currentConceptKey = selectedConcept ? selectedConcept.title : "global";
            const computedGradeAvg = Math.round(
              (Number(activeScoreCard.simplicity || 0) + Number(activeScoreCard.completeness || 0) + Number(activeScoreCard.accuracy || 0)) / 3
            );

            return (
              <motion.div
                key="feedback-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.25 }}
                className="max-w-4xl mx-auto w-full flex-1 flex flex-col space-y-6 pb-10"
                id="details-feedback-container"
              >
                {/* Big Grade Box Layout */}
                <div 
                  className="rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-6 space-y-4 shadow-xs" 
                  id="feedback-grade-card"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">Overall Grade · {currentConceptKey}</span>
                    <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">{computedGradeAvg}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-white/[0.06] h-2.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-violet-600 dark:bg-fuchsia-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${computedGradeAvg}%` }}
                    />
                  </div>
                </div>

                {/* Sliders Area */}
                <div className="rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-6 space-y-5 shadow-xs" id="feedback-sliders-group">
                  
                  {/* Simplicity */}
                  <div className="space-y-2" id="slider-simplicity-container">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Simplicity</span>
                      <span className="font-semibold text-slate-600 dark:text-slate-400 font-mono tabular-nums">{activeScoreCard.simplicity}%</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-white/[0.06] h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-violet-600 dark:bg-fuchsia-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${activeScoreCard.simplicity}%` }}
                      />
                    </div>
                  </div>

                  {/* Completeness */}
                  <div className="space-y-2" id="slider-completeness-container">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Completeness</span>
                      <span className="font-semibold text-slate-600 dark:text-slate-400 font-mono tabular-nums">{activeScoreCard.completeness}%</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-white/[0.06] h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-violet-600 dark:bg-fuchsia-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${activeScoreCard.completeness}%` }}
                      />
                    </div>
                  </div>

                  {/* Accuracy */}
                  <div className="space-y-2" id="slider-accuracy-container">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Accuracy</span>
                      <span className="font-semibold text-slate-600 dark:text-slate-400 font-mono tabular-nums">{activeScoreCard.accuracy}%</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-white/[0.06] h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-violet-600 dark:bg-fuchsia-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${activeScoreCard.accuracy}%` }}
                      />
                    </div>
                    {activeScoreCard.diagramUnderstanding ? (
                      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        Scored from the idea the diagram expresses, not from pixels or how closely it matches a reference figure.
                      </p>
                    ) : null}
                  </div>

                </div>

                {activeScoreCard.diagramUnderstanding ? (
                  <div className="space-y-3" id="diagram-understanding-section">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                      What the diagram means
                    </h3>
                    <div className="bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] px-4 py-3.5 rounded-xl shadow-xs">
                      <p className="text-xs md:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {activeScoreCard.diagramUnderstanding}
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Gaps in Understanding List */}
                <div className="space-y-3" id="gaps-understanding-section">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                    Gaps in Understanding
                  </h3>
                  <div className="space-y-2.5" id="gaps-understanding-list">
                    {activeScoreCard.gaps.map((gap, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-start space-x-3 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] px-4 py-3.5 rounded-xl shadow-xs"
                        id={`gap-item-${idx}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-600 dark:bg-fuchsia-400 mt-2 shrink-0" />
                        <p className="text-xs md:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{gap}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Curious Student Follow-up Question Card */}
                <div className="rounded-2xl border border-violet-200/80 dark:border-violet-500/25 bg-violet-50/60 dark:bg-violet-950/20 p-5" id="feynman-followup-card">
                  <div className="flex items-center space-x-2 mb-2.5">
                    <BrainCircuit className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">Feynman's Follow-up Question</span>
                  </div>
                  <p className="text-xs md:text-sm text-slate-800 dark:text-slate-200 font-medium leading-relaxed italic">
                    "{activeScoreCard.feedbackText}"
                  </p>
                </div>

                {/* Grounded Source Passages (from Vector Retrieval) */}
                {activeScoreCard.citations && activeScoreCard.citations.length > 0 && (
                  <div className="space-y-3" id="feedback-citations-section">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                        Referenced Study Material Passages
                      </h3>
                      {activeScoreCard.retrievalLatencyMs !== undefined && (
                        <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                          Retrieved in {activeScoreCard.retrievalLatencyMs}ms
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {activeScoreCard.citations.map((cit, idx) => (
                        <div
                          key={`${cit.chunkId}-${idx}`}
                          className="rounded-xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-3.5 space-y-1.5 shadow-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 truncate">
                              {cit.sectionTitle || "Study Passage"}
                            </span>
                            <span className="text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/[0.06] px-2 py-0.5 rounded shrink-0 tabular-nums">
                              {cit.pageNumber === cit.pageEnd
                                ? `Page ${cit.pageNumber}`
                                : `Pages ${cit.pageNumber}–${cit.pageEnd}`}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
                            {cit.excerpt}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom Action Footer Row */}
                <div className="flex items-center justify-between pt-5 border-t border-slate-200/80 dark:border-white/[0.07]" id="feedback-actions-row">
                  
                  {/* Bottom Left: Mark Revised button */}
                  <button
                    id="btn-mark-revised"
                    onClick={handleMarkRevised}
                    className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl border transition-all text-xs font-semibold cursor-pointer ${
                      revisedConcepts.includes(currentConceptKey)
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                        : "bg-white dark:bg-white/[0.04] border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08]"
                    }`}
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>{revisedConcepts.includes(currentConceptKey) ? "Revised" : "Mark revised"}</span>
                  </button>

                  {/* Bottom Right: Try Again Button */}
                  <button
                    id="btn-try-again"
                    onClick={() => {
                      setActiveTab("explain");
                    }}
                    className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white transition-all text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Try again</span>
                  </button>

                </div>

                {/* Floating toast notification when marked revised */}
                <AnimatePresence>
                  {showRevisedToast && (
                    <motion.div
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 15 }}
                      className="fixed bottom-6 left-6 bg-white dark:bg-[#0a1f14] border border-emerald-200 dark:border-emerald-500/40 px-4 py-3 rounded-xl shadow-lg flex items-center space-x-3 z-50"
                      id="revised-concept-toast"
                    >
                      <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Concept marked as revised successfully!</span>
                    </motion.div>
                  )}
                </AnimatePresence>

              </motion.div>
            );
          })()}

          {/* TAB 3: KNOWLEDGE MAP RELATION VIEWER */}
          {activeTab === "map" && (() => {
            const mainTopicName = file.name.replace(/\.[^/.]+$/, "");
            const fitTopicText = (name: string) => {
              const cleaned = name.replace(/[\s-_]+/g, " ").trim();
              const words = cleaned.split(" ");
              if (words.length === 1) {
                return words[0].length > 9 ? [words[0].substring(0, 7) + "..."] : [words[0]];
              }
              // Gather words into two lines of approx balanced length
              let firstLine = words[0];
              let secondLine = "";
              for (let i = 1; i < words.length; i++) {
                if (firstLine.length + words[i].length < 10 && secondLine === "") {
                  firstLine += " " + words[i];
                } else {
                  if (secondLine !== "") secondLine += " ";
                  secondLine += words[i];
                }
              }
              if (firstLine.length > 9) firstLine = firstLine.substring(0, 8) + "...";
              if (secondLine.length > 9) secondLine = secondLine.substring(0, 8) + "...";
              return secondLine ? [firstLine, secondLine] : [firstLine];
            };

            const numConcepts = concepts.length;
            const centerX = 330;
            const centerY = 210;
            const orbitRadius = 140;

            // Compute overall mastery from scorecards
            let totalScoreSum = 0;
            let gradedCount = 0;
            concepts.forEach(c => {
              const sc = scoreCards[c.title];
              if (sc) {
                const avg = (Number(sc.simplicity || 0) + Number(sc.completeness || 0) + Number(sc.accuracy || 0)) / 3;
                totalScoreSum += avg;
                gradedCount++;
              }
            });
            const overallMastery = gradedCount === 0 ? 0 : Math.round(totalScoreSum / gradedCount);

            // Center Big Circle colors based on mastery level
            let mainBgColor = "fill-violet-50 dark:fill-[#1b102d]";
            let mainStrokeColor = "stroke-violet-500/80 dark:stroke-purple-500/80";
            let mainGlowColor = theme === "dark" ? "rgba(217, 70, 239, 0.25)" : "rgba(124, 58, 237, 0.14)";
            if (overallMastery >= 85) {
              mainBgColor = "fill-emerald-50 dark:fill-[#072114]";
              mainStrokeColor = "stroke-emerald-500/80";
              mainGlowColor = theme === "dark" ? "rgba(16, 185, 129, 0.3)" : "rgba(16, 185, 129, 0.16)";
            } else if (overallMastery >= 60) {
              mainBgColor = "fill-amber-50 dark:fill-[#221707]";
              mainStrokeColor = "stroke-amber-500/80";
              mainGlowColor = theme === "dark" ? "rgba(245, 158, 11, 0.28)" : "rgba(245, 158, 11, 0.16)";
            }

            // Map subtopics to orbit coordinates and style attributes
            const nodes = concepts.map((concept, index) => {
              // Radial angle starting from the top
              const angle = (index * 2 * Math.PI) / (numConcepts || 1) - Math.PI / 2;
              const posX = centerX + orbitRadius * Math.cos(angle);
              const posY = centerY + orbitRadius * Math.sin(angle);

              // Assign importance percentage based on difficulty
              let baseImportance = 0.7;
              if (concept.difficulty === "Hard") baseImportance = 0.9;
              else if (concept.difficulty === "Medium") baseImportance = 0.7;
              else if (concept.difficulty === "Easy") baseImportance = 0.5;

              // Deterministic minor variance based on concept index
              const variance = (((index + 3) % 3) - 1) * 0.08;
              const importanceValue = Math.min(1.0, Math.max(0.35, baseImportance + variance));
              const radius = 20 + importanceValue * 15; // Sizes range from 20 to 35

              // Mastery status color coding
              const sc = scoreCards[concept.title];
              let nodeColor = "#8b5cf6";
              let nodeBgClass = "fill-violet-50 dark:fill-[#17112b]";
              let nodeStrokeClass = "stroke-violet-400/80 dark:stroke-purple-500/60 hover:stroke-violet-600 dark:hover:stroke-[#d946ef]";
              let nodeTitle = "Study Needed";

              if (sc) {
                const avg = Math.round((Number(sc.simplicity || 0) + Number(sc.completeness || 0) + Number(sc.accuracy || 0)) / 3);
                if (avg >= 85) {
                  nodeColor = "#10b981";
                  nodeBgClass = "fill-emerald-50 dark:fill-emerald-950/60";
                  nodeStrokeClass = "stroke-emerald-500/75 hover:stroke-emerald-600 dark:hover:stroke-emerald-400";
                  nodeTitle = `Mastered (${avg}%)`;
                } else if (avg >= 60) {
                  nodeColor = "#f59e0b";
                  nodeBgClass = "fill-amber-50 dark:fill-amber-950/50";
                  nodeStrokeClass = "stroke-amber-500/75 hover:stroke-amber-600 dark:hover:stroke-amber-400";
                  nodeTitle = `Developing (${avg}%)`;
                } else {
                  nodeColor = "#ef4444";
                  nodeBgClass = "fill-rose-50 dark:fill-rose-950/50";
                  nodeStrokeClass = "stroke-rose-500/75 hover:stroke-rose-600 dark:hover:stroke-rose-400";
                  nodeTitle = `Needs Work (${avg}%)`;
                }
              }

              return {
                concept,
                x: posX,
                y: posY,
                radius,
                importance: Math.round(importanceValue * 100),
                nodeColor,
                nodeBgClass,
                nodeStrokeClass,
                nodeTitle,
                isGraded: !!sc
              };
            });

            return (
              <motion.div
                key="map-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.25 }}
                className="flex-1 flex flex-col space-y-5"
                id="details-map-container"
              >
                {/* Sub-navigation Switcher Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-xl p-2.5 shadow-xs" id="map-subnav-bar">
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.06] gap-1">
                    <button
                      onClick={() => setMapSubView("orbit")}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center space-x-2 cursor-pointer whitespace-nowrap shrink-0 ${
                        mapSubView === "orbit"
                          ? "bg-white dark:bg-[#19192e] text-slate-900 dark:text-white shadow-xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                      <span>Interactive Orbit Map</span>
                    </button>

                    <button
                      onClick={() => setMapSubView("quiz")}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center space-x-2 cursor-pointer whitespace-nowrap shrink-0 ${
                        mapSubView === "quiz"
                          ? "bg-white dark:bg-[#19192e] text-slate-900 dark:text-white shadow-xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                      <span>Flashcard Quiz Deck</span>
                      {flashcards.length > 0 && (
                        <span className="bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold tabular-nums">
                          {flashcards.length}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center space-x-2.5">
                    {mapSubView === "quiz" && (
                      <button
                        onClick={handleGenerateAiFlashcards}
                        disabled={loadingFlashcards}
                        className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0 shadow-xs"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${loadingFlashcards ? "animate-spin" : ""}`} />
                        <span>{loadingFlashcards ? "Generating Deck..." : "AI Generate Cards"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* MODE 1: INTERACTIVE CONSTELLATION MAP */}
                {mapSubView === "orbit" && (
                  <div className="flex flex-col lg:flex-row gap-5 flex-1 items-stretch" id="knowledge-map-root-layout">
                    
                    {/* Left Column: Interactive Constellation Graph */}
                    <div className="flex-1 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden shadow-xs" id="knowledge-map-workspace">
                      <div id="knowledge-map-meta" className="relative z-20">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center space-x-2">
                          <Sliders className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                          <span>Interactive Concept Map</span>
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {file.documentOverview || "Click any subtopic node to inspect its summary, or double-click to start explaining."}
                        </p>
                      </div>

                      {/* SVG Constellation Stage */}
                      <div className="flex-1 min-h-[380px] border border-slate-200/80 dark:border-white/[0.06] rounded-xl my-5 bg-slate-50/70 dark:bg-[#080814] flex items-center justify-center relative overflow-hidden" id="canvas-map-deck">
                        {/* Architectural Grid overlay */}
                        <div
                          className="absolute inset-0 opacity-60 dark:opacity-20 pointer-events-none"
                          style={{
                            backgroundImage: `linear-gradient(to right, ${theme === "dark" ? "#1e1e3f" : "#e2e8f0"} 1px, transparent 1px), linear-gradient(to bottom, ${theme === "dark" ? "#1e1e3f" : "#e2e8f0"} 1px, transparent 1px)`,
                            backgroundSize: "24px 24px"
                          }}
                        />
                        
                        {concepts.length === 0 ? (
                          <div className="text-center relative z-10" id="empty-map-fallback">
                            <div className="w-6 h-6 border-2 border-violet-600 dark:border-violet-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <span className="text-xs text-slate-500 dark:text-slate-400">Mapping constellation...</span>
                          </div>
                        ) : (
                          <svg className="w-full h-full min-h-[375px] relative z-20" viewBox="0 0 660 420" id="concept-map-canvas">
                            <defs>
                              <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor={theme === "dark" ? "#2e1065" : "#ddd6fe"} stopOpacity="0.65"/>
                                <stop offset="100%" stopColor={theme === "dark" ? "#080814" : "#f8fafc"} stopOpacity="0"/>
                              </radialGradient>
                            </defs>

                            {/* 1. DRAW LINKS FIRST */}
                            {nodes.map((node, i) => {
                              const isSelected = selectedConcept?.id === node.concept.id;
                              return (
                                <g key={`links-group-${i}`}>
                                  <line
                                    x1={centerX}
                                    y1={centerY}
                                    x2={node.x}
                                    y2={node.y}
                                    className={`transition-all duration-300 ${
                                      isSelected 
                                        ? "stroke-violet-600 dark:stroke-fuchsia-400 stroke-[2]" 
                                        : "stroke-slate-300 dark:stroke-slate-700 stroke-[1.25]"
                                    }`}
                                    strokeDasharray={isSelected ? "none" : "4 4"}
                                  />
                                  {isSelected && (
                                    <line
                                      x1={centerX}
                                      y1={centerY}
                                      x2={node.x}
                                      y2={node.y}
                                      stroke={node.nodeColor}
                                      strokeWidth="3.5"
                                      className="opacity-20"
                                    />
                                  )}
                                </g>
                              );
                            })}

                            {/* 2. DRAW CENTER BIG CIRCLE (Main Topic) */}
                            <g className="cursor-default select-none" id="main-topic-center-node">
                              <circle
                                cx={centerX}
                                cy={centerY}
                                r="56"
                                fill="url(#centerGlow)"
                                stroke={overallMastery > 0 ? (overallMastery >= 85 ? "#10b981" : "#f59e0b") : "#8b5cf6"}
                                strokeWidth="1"
                                className="opacity-25 stroke-dasharray-[4_3] animate-[spin_40s_linear_infinite]"
                              />
                              <circle
                                cx={centerX}
                                cy={centerY}
                                r="46"
                                className={`${mainBgColor} ${mainStrokeColor} transition-all duration-500`}
                                strokeWidth="2.5"
                                style={{ filter: `drop-shadow(0px 0px 12px ${mainGlowColor})` }}
                              />
                              {(() => {
                                const lines = fitTopicText(mainTopicName);
                                if (lines.length === 2) {
                                  return (
                                    <>
                                      <text
                                        x={centerX}
                                        y={centerY - 8}
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        className="fill-slate-900 dark:fill-white text-[9px] sm:text-[9.5px] font-bold select-none tracking-wider uppercase"
                                      >
                                        {lines[0]}
                                      </text>
                                      <text
                                        x={centerX}
                                        y={centerY + 3}
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        className="fill-slate-900 dark:fill-white text-[9px] sm:text-[9.5px] font-bold select-none tracking-wider uppercase"
                                      >
                                        {lines[1]}
                                      </text>
                                      <text
                                        x={centerX}
                                        y={centerY + 16}
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        className="fill-slate-500 dark:fill-slate-400 text-[8px] font-semibold select-none tracking-wider font-mono"
                                      >
                                        {overallMastery > 0 ? `${overallMastery}% Mastery` : "Click Nodes"}
                                      </text>
                                    </>
                                  );
                                }
                                return (
                                  <>
                                    <text
                                      x={centerX}
                                      y={centerY - 2}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      className="fill-slate-900 dark:fill-white text-[10px] sm:text-[11px] font-bold select-none tracking-wider uppercase"
                                    >
                                      {lines[0]}
                                    </text>
                                    <text
                                      x={centerX}
                                      y={centerY + 12}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      className="fill-slate-500 dark:fill-slate-400 text-[8px] font-semibold select-none tracking-wider font-mono"
                                    >
                                      {overallMastery > 0 ? `${overallMastery}% Mastery` : "Click Nodes"}
                                    </text>
                                  </>
                                );
                              })()}
                            </g>

                            {/* 3. DRAW SUBTOPIC SMALL CIRCLES */}
                            {nodes.map((node, i) => {
                              const isSelected = selectedConcept?.id === node.concept.id;
                              return (
                                <g
                                  key={`subnode-${i}`}
                                  className="cursor-pointer group"
                                  onClick={() => setSelectedConcept(node.concept)}
                                  onDoubleClick={() => handleSelectConcept(node.concept)}
                                >
                                  {/* Outer ring highlight */}
                                  <circle
                                    cx={node.x}
                                    cy={node.y}
                                    r={node.radius + 6}
                                    className={`fill-transparent stroke-transparent transition-all duration-300 ${
                                      isSelected 
                                        ? "stroke-violet-500/60 dark:stroke-fuchsia-400/60 fill-violet-500/5" 
                                        : "group-hover:stroke-slate-300 dark:group-hover:stroke-slate-700"
                                    }`}
                                    strokeWidth="1"
                                    strokeDasharray={isSelected ? "none" : "2 2"}
                                  />

                                  {/* Subtopic Bubble */}
                                  <circle
                                    cx={node.x}
                                    cy={node.y}
                                    r={node.radius}
                                    className={`${node.nodeBgClass} ${node.nodeStrokeClass} transition-all duration-300`}
                                    strokeWidth={isSelected ? "2" : "1.5"}
                                    style={{
                                      filter: isSelected ? `drop-shadow(0px 0px 8px ${node.nodeColor}45)` : "none"
                                    }}
                                  />

                                  {/* Subtopic index tag */}
                                  <text
                                    x={node.x}
                                    y={node.y}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    className="fill-slate-900 dark:fill-white text-[10px] font-bold tracking-tight select-none font-mono"
                                  >
                                    {i + 1}
                                  </text>

                                  {/* Label above circle */}
                                  <text
                                    x={node.x}
                                    y={node.y - (node.radius + 10)}
                                    textAnchor="middle"
                                    className={`text-[9.5px] font-semibold select-none transition-colors ${
                                      isSelected 
                                        ? "fill-violet-700 dark:fill-violet-300" 
                                        : "fill-slate-600 dark:fill-slate-400 group-hover:fill-slate-900 dark:group-hover:fill-slate-200"
                                    }`}
                                  >
                                    {node.concept.title.length > 15 
                                      ? node.concept.title.substring(0, 13) + "..." 
                                      : node.concept.title}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        )}
                      </div>

                      {/* Footer instructions & legend keys inside constellation panel */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-[11px] text-slate-500 dark:text-slate-400 px-1 relative z-20" id="canvas-map-key">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <div className="flex items-center space-x-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-100 dark:bg-emerald-500/25 border border-emerald-500" />
                            <span>Mastered (85%+)</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-100 dark:bg-amber-500/25 border border-amber-500" />
                            <span>Developing (60%+)</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-violet-100 dark:bg-violet-500/25 border border-violet-500" />
                            <span>Study needed</span>
                          </div>
                        </div>
                        <span className="font-medium text-slate-500 dark:text-slate-400 font-mono tabular-nums">Total Subtopics: {concepts.length}</span>
                      </div>

                    </div>

                    {/* Right Column: Node details & telemetry actions drawer card */}
                    <div 
                      className="w-full lg:w-80 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-xs"
                      id="inspect-details-panel"
                    >
                      {selectedConcept ? (() => {
                        const sc = scoreCards[selectedConcept.title];
                        const conceptNodeStats = nodes.find(n => n.concept.id === selectedConcept.id);
                        const nodeTitleStatus = conceptNodeStats ? conceptNodeStats.nodeTitle : "Needs Study";
                        const isCompleted = !!sc;

                        return (
                          <div className="space-y-5 flex-1 flex flex-col justify-between" id="inspection-content-layout">
                            <div className="space-y-4">
                              
                              {/* Header details block */}
                              <div className="border-b border-slate-200/80 dark:border-white/[0.07] pb-3.5" id="inspection-header">
                                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Selected Concept</span>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1 leading-snug">{selectedConcept.title}</h4>
                                
                                <div className="flex items-center gap-2 mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400" id="inspect-badges-row">
                                  <span className={`font-semibold ${
                                    selectedConcept.difficulty === "Hard"
                                      ? "text-rose-600 dark:text-rose-400"
                                      : selectedConcept.difficulty === "Medium"
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                  }`}>
                                    {selectedConcept.difficulty} difficulty
                                  </span>
                                  <span>·</span>
                                  <span className={isCompleted ? "text-emerald-600 dark:text-emerald-400" : "text-violet-600 dark:text-violet-400"}>
                                    {nodeTitleStatus}
                                  </span>
                                </div>
                              </div>

                              {/* Info segment summary */}
                              <div className="space-y-3" id="inspection-metrics">
                                <div className="p-3.5 bg-slate-50/80 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.06] rounded-xl space-y-2" id="inspect-summary-box">
                                  <div className="flex items-center justify-between gap-2">
                                    <h5 className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 dark:text-slate-400">Concept Summary</h5>
                                    {selectedConcept.pageStart && (
                                      <span className="text-[10px] font-mono font-semibold text-violet-600 dark:text-violet-300 tabular-nums">
                                        {selectedConcept.pageEnd && selectedConcept.pageEnd !== selectedConcept.pageStart
                                          ? `pp. ${selectedConcept.pageStart}–${selectedConcept.pageEnd}`
                                          : `p. ${selectedConcept.pageStart}`}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{selectedConcept.summary}</p>
                                  {selectedConcept.sectionTitle && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-white/[0.05]">
                                      Section: {selectedConcept.sectionTitle}
                                    </p>
                                  )}
                                </div>
                              </div>

                            </div>

                            {/* Trigger Call To Action */}
                            <div className="pt-4 border-t border-slate-200/80 dark:border-white/[0.07] space-y-2" id="inspection-footer-actions">
                              <button
                                id="btn-inspect-quiz"
                                onClick={() => {
                                  setConceptFilter(selectedConcept.title);
                                  setMapSubView("quiz");
                                  setCurrentCardIndex(0);
                                  setIsCardFlipped(false);
                                  setSelectedOption(null);
                                  setQuizCompleted(false);
                                }}
                                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.08] transition-all cursor-pointer"
                              >
                                <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                                <span>Practice Concept Flashcards</span>
                              </button>

                              <button
                                id="btn-inspect-teach"
                                onClick={() => {
                                  handleSelectConcept(selectedConcept);
                                }}
                                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-xs font-semibold text-white transition-all cursor-pointer shadow-xs"
                              >
                                <BrainCircuit className="w-4 h-4" />
                                <span>Teach Feynman This Concept</span>
                              </button>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center select-none leading-normal pt-0.5">
                                Double click subtopics to launch explanation arena directly.
                              </p>
                            </div>

                          </div>
                        );
                      })() : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3" id="inspect-empty">
                          <BookOpen className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                          <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold">Inspect Concept Node</span>
                          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-[210px]">
                            Select any surrounding subtopic circle to view its summary or launch a practice session.
                          </p>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* MODE 2: FLASHCARD QUIZ DECK */}
                {mapSubView === "quiz" && (() => {
                  const filteredCards = conceptFilter === "all"
                    ? flashcards
                    : flashcards.filter(c => c.conceptTitle.toLowerCase().trim() === conceptFilter.toLowerCase().trim());

                  const currentCard = filteredCards[currentCardIndex];

                  const handleNextCard = () => {
                    setIsCardFlipped(false);
                    setSelectedOption(null);
                    if (currentCardIndex < filteredCards.length - 1) {
                      setCurrentCardIndex(prev => prev + 1);
                    } else {
                      setQuizCompleted(true);
                    }
                  };

                  const handlePrevCard = () => {
                    if (currentCardIndex > 0) {
                      setIsCardFlipped(false);
                      setSelectedOption(null);
                      setCurrentCardIndex(prev => prev - 1);
                    }
                  };

                  const handleRateCard = (isMastered: boolean) => {
                    if (!currentCard) return;
                    if (isMastered) {
                      setMasteredCardIds(prev => new Set(prev).add(currentCard.id));
                      setReviewCardIds(prev => {
                        const next = new Set(prev);
                        next.delete(currentCard.id);
                        return next;
                      });
                    } else {
                      setReviewCardIds(prev => new Set(prev).add(currentCard.id));
                      setMasteredCardIds(prev => {
                        const next = new Set(prev);
                        next.delete(currentCard.id);
                        return next;
                      });
                    }
                    handleNextCard();
                  };

                  const handleShuffle = () => {
                    setFlashcards(prev => [...prev].sort(() => Math.random() - 0.5));
                    setCurrentCardIndex(0);
                    setIsCardFlipped(false);
                    setSelectedOption(null);
                    setQuizCompleted(false);
                  };

                  const handleResetQuiz = () => {
                    setCurrentCardIndex(0);
                    setIsCardFlipped(false);
                    setSelectedOption(null);
                    setQuizCompleted(false);
                    setMasteredCardIds(new Set());
                    setReviewCardIds(new Set());
                  };

                  const masteredCount = masteredCardIds.size;
                  const reviewCount = reviewCardIds.size;
                  const totalAttempted = masteredCount + reviewCount;
                  const accuracyPct = totalAttempted > 0 ? Math.round((masteredCount / totalAttempted) * 100) : 0;

                  return (
                    <div className="flex-1 flex flex-col space-y-6" id="flashcard-quiz-container">
                      
                      {/* Top Filter & Score Dashboard Bar */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-xl p-4 shadow-xs">
                        
                        {/* Concept Filter Dropdown */}
                        <div className="flex items-center space-x-2.5">
                          <Filter className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Filter Topic:</span>
                          <select
                            value={conceptFilter}
                            onChange={(e) => {
                              setConceptFilter(e.target.value);
                              setCurrentCardIndex(0);
                              setIsCardFlipped(false);
                              setSelectedOption(null);
                              setQuizCompleted(false);
                            }}
                            className="bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-slate-200 rounded-lg px-3 py-1.5 font-medium focus:outline-none focus:border-violet-500 cursor-pointer"
                          >
                            <option value="all">All Upload Concepts ({flashcards.length})</option>
                            {concepts.map(c => (
                              <option key={c.id} value={c.title}>
                                {c.title}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Deck Stats & Action Controls */}
                        <div className="flex items-center space-x-3 text-xs">
                          <div className="flex items-center space-x-3 bg-slate-50 dark:bg-[#080814] border border-slate-200/90 dark:border-white/[0.08] px-3 py-1.5 rounded-lg tabular-nums">
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> {masteredCount} Mastered
                            </span>
                            <span className="text-slate-300 dark:text-slate-700">|</span>
                            <span className="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                              <X className="w-3.5 h-3.5" /> {reviewCount} Review
                            </span>
                          </div>

                          <button
                            onClick={handleShuffle}
                            title="Shuffle card deck"
                            className="p-2 rounded-lg bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-violet-400 transition-all cursor-pointer"
                          >
                            <Shuffle className="w-4 h-4" />
                          </button>

                          <button
                            onClick={handleResetQuiz}
                            title="Restart quiz"
                            className="p-2 rounded-lg bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-violet-400 transition-all cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </div>

                      </div>

                      {/* Main Flashcard Display Area */}
                      {filteredCards.length === 0 ? (
                        <div className="flex-1 min-h-[350px] bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-4 shadow-xs">
                          <Layers className="w-10 h-10 text-violet-600 dark:text-violet-400" />
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">No flashcards found for this selection</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
                            Generate AI flashcards directly from your uploaded document or choose "All Upload Concepts".
                          </p>
                          <button
                            onClick={handleGenerateAiFlashcards}
                            disabled={loadingFlashcards}
                            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-xs font-semibold text-white transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
                          >
                            <Sparkles className="w-4 h-4" />
                            <span>Generate AI Flashcards Deck</span>
                          </button>
                        </div>
                      ) : quizCompleted ? (
                        /* Quiz Summary Screen */
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex-1 min-h-[380px] bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-6 shadow-xs"
                        >
                          <div className="w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30 flex items-center justify-center">
                            <Award className="w-8 h-8 text-violet-600 dark:text-violet-400" />
                          </div>

                          <div className="space-y-1.5">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Flashcard Quiz Completed</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Great job practicing concepts from <span className="text-violet-600 dark:text-violet-400 font-semibold">{file.name}</span>.
                            </p>
                          </div>

                          {/* Results Score */}
                          <div className="grid grid-cols-3 gap-4 w-full max-w-md bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/[0.08] rounded-xl p-4 tabular-nums">
                            <div>
                              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{masteredCount}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-1">Mastered</div>
                            </div>
                            <div>
                              <div className="text-xl font-bold text-rose-600 dark:text-rose-400">{reviewCount}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-1">Need Review</div>
                            </div>
                            <div>
                              <div className="text-xl font-bold text-violet-600 dark:text-violet-300">{accuracyPct}%</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-1">Accuracy</div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-3 pt-2">
                            <button
                              onClick={handleResetQuiz}
                              className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-xs font-semibold text-white transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
                            >
                              <RotateCcw className="w-4 h-4" />
                              <span>Restart Quiz</span>
                            </button>

                            <button
                              onClick={() => setMapSubView("orbit")}
                              className="px-5 py-2.5 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08] transition-all cursor-pointer"
                            >
                              <span>Back to Concept Map</span>
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        /* Active Flashcard View */
                        <div className="flex-1 flex flex-col items-center justify-center space-y-5 min-h-[440px]">
                          
                          {/* Card Counter & Concept Metadata */}
                          <div className="flex items-center justify-between w-full max-w-xl text-xs px-1">
                            <span className="font-mono text-slate-500 dark:text-slate-400 font-semibold tabular-nums">
                              Card <span className="text-violet-600 dark:text-violet-400">{currentCardIndex + 1}</span> of {filteredCards.length}
                            </span>
                            <div className="flex items-center space-x-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              <span className="text-slate-700 dark:text-slate-300 font-semibold truncate max-w-[200px]">
                                {currentCard?.conceptTitle}
                              </span>
                              <span>·</span>
                              <span className="text-violet-600 dark:text-violet-400 font-mono font-semibold uppercase">
                                {currentCard?.cardType === "fill_blank" ? "Fill Blank" : "MCQ"}
                              </span>
                            </div>
                          </div>

                          {/* 3D Flip Card Container */}
                          <div className="w-full max-w-xl h-[360px] sm:h-[380px] relative perspective-1000">
                            <motion.div
                              animate={{ rotateY: isCardFlipped ? 180 : 0 }}
                              transition={{ duration: 0.5, ease: "easeInOut" }}
                              style={{ transformStyle: "preserve-3d" }}
                              className="w-full h-full relative select-none rounded-2xl"
                            >
                              {/* FRONT SIDE */}
                              <div 
                                style={{ backfaceVisibility: "hidden" }}
                                className="absolute inset-0 w-full h-full bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between shadow-lg dark:shadow-2xl overflow-y-auto"
                              >
                                {/* Header */}
                                <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-white/[0.07] pb-3">
                                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    {currentCard?.cardType === "fill_blank" ? (
                                      <>
                                        <BookOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                        <span>Fill in the Blank</span>
                                      </>
                                    ) : (
                                      <>
                                        <Sliders className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                                        <span>Multiple Choice</span>
                                      </>
                                    )}
                                  </span>
                                  {currentCard?.difficulty && (
                                    <span className={`text-[10px] font-mono font-semibold uppercase ${
                                      currentCard.difficulty === "Hard"
                                        ? "text-rose-600 dark:text-rose-400"
                                        : currentCard.difficulty === "Medium"
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-emerald-600 dark:text-emerald-400"
                                    }`}>
                                      {currentCard.difficulty}
                                    </span>
                                  )}
                                </div>

                                {/* Question Content */}
                                <div className="my-auto space-y-4 py-2">
                                  {currentCard?.cardType === "fill_blank" ? (
                                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-relaxed">
                                      {currentCard?.question.includes("___") ? (
                                        <>
                                          {currentCard.question.split("___")[0]}
                                          <span className="inline-block px-3 py-0.5 my-0.5 mx-1.5 rounded-lg bg-violet-50 dark:bg-indigo-950/80 border border-violet-300 dark:border-indigo-500/60 text-violet-700 dark:text-indigo-200 font-mono text-sm underline decoration-violet-400 decoration-dashed">
                                            {selectedOption || "__________"}
                                          </span>
                                          {currentCard.question.split("___")[1]}
                                        </>
                                      ) : (
                                        currentCard?.question
                                      )}
                                    </h3>
                                  ) : (
                                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-relaxed">
                                      {currentCard?.question}
                                    </h3>
                                  )}

                                  {/* Option Choices list */}
                                  {currentCard?.options && currentCard.options.length > 0 && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
                                      {currentCard.options.map((opt, oIdx) => {
                                        const isSelected = selectedOption === opt;
                                        let btnStyle = "bg-slate-50 dark:bg-[#080814] border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:border-violet-400 dark:hover:border-violet-500/60 hover:text-slate-900 dark:hover:text-white";
                                        if (isSelected) {
                                          btnStyle = "bg-violet-50 dark:bg-violet-500/20 border-violet-500 text-violet-900 dark:text-violet-100 shadow-xs";
                                        }
                                        return (
                                          <button
                                            key={oIdx}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedOption(opt);
                                            }}
                                            className={`p-3 rounded-xl border text-xs text-left transition-all cursor-pointer flex items-center justify-between gap-2 min-h-[44px] ${btnStyle}`}
                                          >
                                            <span className="flex items-center space-x-2.5">
                                              <span className="font-mono text-[11px] font-semibold text-slate-400 dark:text-slate-500 shrink-0">
                                                {String.fromCharCode(65 + oIdx)}.
                                              </span>
                                              <span className="font-semibold text-xs sm:text-sm leading-snug break-words">
                                                {opt}
                                              </span>
                                            </span>
                                            {isSelected && <Check className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 ml-1" />}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                {/* Footer Action */}
                                <div className="pt-3 border-t border-slate-200/80 dark:border-white/[0.07] flex items-center justify-between text-[11px]">
                                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    <RotateCw className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                                    <span>Select an option then check answer</span>
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setIsCardFlipped(true);
                                    }}
                                    className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 shadow-xs whitespace-nowrap"
                                  >
                                    <span>Check Answer</span>
                                    <Sparkles className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* BACK SIDE */}
                              <div 
                                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                                className="absolute inset-0 w-full h-full bg-white dark:bg-[#0E0E1D] border border-violet-300 dark:border-violet-500/40 rounded-2xl p-6 flex flex-col justify-between shadow-lg dark:shadow-2xl overflow-y-auto"
                              >
                                {/* Header */}
                                <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-white/[0.07] pb-3">
                                  <span className="text-[11px] font-mono uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Answer Breakdown</span>
                                  </span>
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[180px]">{currentCard?.conceptTitle}</span>
                                </div>

                                {/* Result & Explanation Sections */}
                                <div className="my-auto space-y-3 py-2">
                                  
                                  {/* Result Banner */}
                                  {selectedOption ? (() => {
                                    const isCorrect = selectedOption.toLowerCase().trim() === currentCard?.answer.toLowerCase().trim();
                                    return (
                                      <div className={`p-3 rounded-xl border flex items-start space-x-2.5 ${
                                        isCorrect
                                          ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-500/40 text-emerald-900 dark:text-emerald-200"
                                          : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-500/40 text-rose-900 dark:text-rose-200"
                                      }`}>
                                        {isCorrect ? (
                                          <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                        ) : (
                                          <X className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                                        )}
                                        <div className="text-xs space-y-0.5">
                                          <div className="font-bold">
                                            {isCorrect ? "Correct Choice!" : "Incorrect Choice"}
                                          </div>
                                          <div className="text-[11px] opacity-90">
                                            {isCorrect
                                              ? `You correctly selected: "${currentCard?.answer}"`
                                              : `Your pick: "${selectedOption}" · Correct Answer: "${currentCard?.answer}"`}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })() : (
                                    <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-500/30 text-violet-900 dark:text-violet-200 flex items-start space-x-2.5">
                                      <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
                                      <div className="text-xs space-y-0.5">
                                        <div className="font-semibold">Correct Answer</div>
                                        <div className="text-sm font-bold text-slate-900 dark:text-white">{currentCard?.answer}</div>
                                      </div>
                                    </div>
                                  )}

                                  {/* EXPLAIN WHY SECTION */}
                                  <div className="p-3 bg-slate-50 dark:bg-[#080814] border border-slate-200/80 dark:border-white/[0.07] rounded-xl space-y-1">
                                    <div className="text-[10px] font-mono font-semibold uppercase text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
                                      <HelpCircle className="w-3.5 h-3.5" />
                                      <span>Why is this answer correct?</span>
                                    </div>
                                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-medium">
                                      {currentCard?.explainWhy || currentCard?.explanation || "This answer directly matches the definition and principles detailed in your uploaded document."}
                                    </p>
                                  </div>

                                  {/* WHAT ABOUT THE ANSWER SECTION */}
                                  <div className="p-3 bg-slate-50 dark:bg-[#080814] border border-slate-200/80 dark:border-white/[0.07] rounded-xl space-y-1">
                                    <div className="text-[10px] font-mono font-semibold uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                                      <BookOpen className="w-3.5 h-3.5" />
                                      <span>What about this concept?</span>
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                      {currentCard?.whatAbout || `This subtopic (${currentCard?.conceptTitle}) represents a key element of the subject material. Reviewing this concept strengthens your overall topic retention.`}
                                    </p>
                                  </div>

                                </div>

                                {/* Rating Bar */}
                                <div className="pt-3 border-t border-slate-200/80 dark:border-white/[0.07] flex items-center justify-between gap-3">
                                  <button
                                    onClick={() => handleRateCard(false)}
                                    className="flex-1 py-2 px-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-all text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                                    <span>Needs Review</span>
                                  </button>

                                  <button
                                    onClick={() => handleRateCard(true)}
                                    className="flex-1 py-2 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Mastered It</span>
                                  </button>
                                </div>

                              </div>

                            </motion.div>
                          </div>

                          {/* Navigation Controls */}
                          <div className="flex items-center space-x-3">
                            <button
                              onClick={handlePrevCard}
                              disabled={currentCardIndex === 0}
                              className="px-4 py-2 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08] disabled:opacity-40 transition-all cursor-pointer"
                            >
                              Previous
                            </button>

                            <button
                              onClick={() => setIsCardFlipped(!isCardFlipped)}
                              className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-xs font-semibold text-white transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                              <span>{isCardFlipped ? "View Question" : "Flip Card"}</span>
                            </button>

                            <button
                              onClick={handleNextCard}
                              disabled={currentCardIndex === filteredCards.length - 1}
                              className="px-4 py-2 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08] disabled:opacity-40 transition-all cursor-pointer"
                            >
                              Next
                            </button>
                          </div>

                        </div>
                      )}

                    </div>
                  );
                })()}

              </motion.div>
            );
          })()}

          {/* TAB: SOURCES / CURATED RESOURCES PANEL */}
          {activeTab === "sources" && (
            <SourcesTab 
              file={file}
              concepts={concepts}
              allFiles={allFiles}
            />
          )}

          {/* TAB 4: HISTORIC PROGRESS PANEL */}
          {activeTab === "progress" && (() => {
            // Dynamic totals computed from other state tabs
            const completedConceptsCount = Object.keys(scoreCards).length;
            const totalConceptsCount = concepts.length || 5;

            let totalMasterySum = 0;
            let gradedCount = 0;
            concepts.forEach(c => {
              const sc = scoreCards[c.title];
              if (sc) {
                const avg = (Number(sc.simplicity || 0) + Number(sc.completeness || 0) + Number(sc.accuracy || 0)) / 3;
                totalMasterySum += avg;
                gradedCount++;
              }
            });
            const computedAvgMastery = gradedCount === 0 ? 0 : Math.round(totalMasterySum / gradedCount);

            // Calculate streak based on real dates in studyLog
            const computeStreak = (log: { date: string }[]) => {
              if (!log || log.length === 0) return 0;
              const uniqueDates = Array.from(new Set(log.map(item => item.date))).sort().reverse();
              if (uniqueDates.length === 0) return 0;
              
              const todayStr = new Date().toISOString().split("T")[0];
              const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split("T")[0];
              
              if (uniqueDates[0] !== todayStr && uniqueDates[0] !== yesterdayStr) {
                return 0;
              }
              
              let streakCount = 1;
              const getMidnightTime = (dateStr: string) => {
                const parts = dateStr.split('-');
                return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime();
              };
              
              let currentRefTime = getMidnightTime(uniqueDates[0]);
              for (let i = 1; i < uniqueDates.length; i++) {
                const prevTime = getMidnightTime(uniqueDates[i]);
                const diffDays = Math.round((currentRefTime - prevTime) / (1000 * 60 * 60 * 24));
                
                if (diffDays === 1) {
                  streakCount++;
                  currentRefTime = prevTime;
                } else if (diffDays > 1) {
                  break;
                }
              }
              return streakCount;
            };
            const realStreak = computeStreak(studyLog);

            // Compute the heatmap cell based on the week index (cIdx) and day index (rIdx)
            const getHeatmapLevel = (dayIndex: number, weekIndex: number): number => {
              const today = new Date();
              const todayDayOfWeek = today.getDay(); // 0-6 (Sunday to Saturday)
              
              const weekOffset = 25 - weekIndex;
              const dayOffset = todayDayOfWeek - dayIndex;
              const totalDaysAgo = weekOffset * 7 + dayOffset;
              
              if (totalDaysAgo < 0) {
                return 0; // Future index
              }
              
              const cellDate = new Date();
              cellDate.setDate(today.getDate() - totalDaysAgo);
              const cellDateStr = cellDate.toISOString().split("T")[0];
              
              const dayMatches = studyLog.filter(item => item.date === cellDateStr);
              if (dayMatches.length === 0) return 0;
              if (dayMatches.length === 1) return 2; // Medium Purple
              if (dayMatches.length === 2) return 3; // Dense Pink-Purple
              return 4; // Radiant hotspot if they study 3+ times a day
            };

            const heatmapColors = [
              "bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.06]", // L0: Empty
              "bg-violet-100 dark:bg-violet-950/50 border border-violet-200 dark:border-violet-800/30", // L1: Faint
              "bg-violet-300 dark:bg-violet-800/60 border border-violet-300 dark:border-violet-700/40", // L2: Moderate
              "bg-violet-500 dark:bg-fuchsia-500/60 border border-violet-500/40 dark:border-fuchsia-400/30", // L3: Rich
              "bg-violet-600 dark:bg-fuchsia-500 border border-violet-700/30 dark:border-white/20" // L4: High
            ];

            // Formatted active timer: shows seconds live so it visibly updates second-by-second
            let formattedTime = "";
            if (studySeconds >= 3600) {
              const hrs = Math.floor(studySeconds / 3600);
              const mins = Math.floor((studySeconds % 3600) / 60);
              const secs = studySeconds % 60;
              formattedTime = `${hrs}h ${mins}m ${secs}s`;
            } else if (studySeconds >= 60) {
              const mins = Math.floor(studySeconds / 60);
              const secs = studySeconds % 60;
              formattedTime = `${mins}m ${secs}s`;
            } else {
              formattedTime = `${studySeconds}s`;
            }

            return (
              <motion.div
                key="progress-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.25 }}
                className="max-w-4xl mx-auto w-full flex-1 flex flex-col space-y-6 pb-10"
                id="details-progress-banner"
              >
                {/* Clean Top Stat Card deck layout */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" id="progress-stats-deck">

                  {/* Card 1: Topics Mastered */}
                  <div className="rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-5 flex flex-col justify-between shadow-xs" id="card-topics-mastered">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-tight">Topics mastered</span>
                    <div className="my-3" id="inner-topics-display">
                      <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                        {completedConceptsCount}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium font-mono tabular-nums">
                      of {totalConceptsCount} total
                    </span>
                  </div>

                  {/* Card 2: Avg Mastery */}
                  <div className="rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-5 flex flex-col justify-between shadow-xs" id="card-avg-mastery">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-tight">Avg mastery</span>
                    <div className="my-3" id="inner-mastery-display">
                      <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                        {computedAvgMastery}%
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium font-mono">across all topics</span>
                  </div>

                  {/* Card 3: Time Studied */}
                  <div className="rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-5 flex flex-col justify-between shadow-xs" id="card-study-time">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-tight">Time studied</span>
                    <div className="my-3" id="inner-time-display">
                      <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">{formattedTime}</span>
                    </div>
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold font-mono tabular-nums">
                      +{studySeconds > 60 ? Math.round(studySeconds / 60) : 1} min elapsed · {realStreak}d streak
                    </span>
                  </div>

                </div>

                {/* Bottom 26-week activity heatmap container */}
                <div 
                  className="rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-6 space-y-4 shadow-xs" 
                  id="progress-activity-heatmap-card"
                >
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight" id="activity-heatmap-title">
                    Activity — last 26 weeks
                  </h4>

                  {/* Horizontal Scrollable Heatmap Wrap */}
                  <div className="overflow-x-auto pb-2 select-none" id="heatmap-overflow-container">
                    <div className="min-w-[420px] flex flex-col space-y-1" id="heatmap-grid-core">
                      {/* Generates standard 7 rows (Sunday to Saturday) */}
                      {Array.from({ length: 7 }).map((_, rIdx) => (
                        <div key={`heatmap-row-${rIdx}`} className="flex space-x-1 justify-start">
                          {/* Day marker label on left side */}
                          <div className="w-6 text-[9px] font-mono text-slate-400 dark:text-slate-500 font-semibold flex items-center pr-1">
                            {rIdx === 1 ? "Mon" : rIdx === 3 ? "Wed" : rIdx === 5 ? "Fri" : ""}
                          </div>
                          
                          {/* 26 columns corresponding to weeks */}
                          {Array.from({ length: 26 }).map((_, cIdx) => {
                            const levelValue = getHeatmapLevel(rIdx, cIdx);
                            return (
                              <div
                                key={`heatmap-cell-${rIdx}-${cIdx}`}
                                className={`w-3.5 h-3.5 rounded-[3px] transition-colors duration-150 ${heatmapColors[levelValue]}`}
                                title={`Week ${cIdx + 1}, Day ${rIdx + 1} activity`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Heatmap Legend row */}
                  <div className="flex justify-end items-center space-x-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono" id="heatmap-legend">
                    <span>Less</span>
                    <div className="flex space-x-1 items-center" id="legend-pills">
                      {heatmapColors.map((cls, idx) => (
                        <div key={idx} className={`w-2.5 h-2.5 rounded-[2px] ${cls}`} />
                      ))}
                    </div>
                    <span>More</span>
                  </div>

                </div>

              </motion.div>
            );
          })()}

        </AnimatePresence>

      </div>

      {/* Uploaded File Reference Sheet/Modal overlay */}
      <AnimatePresence>
        {isSourceDocumentOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            id="source-document-modal"
          >
            {/* Backdrop Blur Overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSourceDocumentOpen(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-md cursor-pointer"
              id="source-document-backdrop"
            />

            {/* Modal Body Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative w-full max-w-2xl bg-white dark:bg-[#0E0E1D] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] z-10"
              id="source-document-body"
            >
              {/* Title Header */}
              <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/80 dark:bg-white/[0.02] px-6 py-4" id="source-doc-header">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30 flex items-center justify-center">
                    <BookOpen className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Original Reference</h3>
                    <p className="text-[11px] font-mono font-semibold tracking-wider text-violet-600 dark:text-violet-400 uppercase mt-0.5">Uploaded Source Material</p>
                  </div>
                </div>
                <button
                  id="btn-close-source-doc"
                  onClick={() => setIsSourceDocumentOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-200/70 dark:hover:bg-white/[0.08] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
                  title="Close source viewer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Central Content Panel */}
              <div className="p-6 overflow-y-auto flex-1 select-text" id="source-doc-content-pane">
                {file.type === "application/pdf" || file.content.startsWith("data:application/pdf") || file.name.toLowerCase().endsWith(".pdf") ? (
                  <div className="flex flex-col space-y-4 w-full">
                    
                    {/* Action Banner */}
                    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-white/[0.03] p-5 relative overflow-hidden">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
                        <div className="space-y-1">
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                            PDF Navigation Control
                          </h4>
                          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
                            Your PDF is loaded for analysis. Scroll through pages below, or download and open the file directly.
                          </p>
                        </div>

                        <div className="flex flex-row items-center gap-2.5 self-start sm:self-center shrink-0">
                          <a 
                            href={pdfActionUrl || file.content}
                            download={file.name}
                            className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-semibold text-white transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs whitespace-nowrap"
                            title="Download PDF to your local machine"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download PDF</span>
                          </a>

                          <a 
                            href={pdfActionUrl || file.content}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3.5 py-2 rounded-lg bg-white dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.1] transition-all flex items-center space-x-1.5 cursor-pointer whitespace-nowrap"
                            title="Open original file in a new browser tab"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open In New Tab</span>
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* PDF.js Inline Canvas Viewer */}
                    <div className="relative h-[48vh] w-full rounded-xl overflow-hidden border border-slate-200 dark:border-white/[0.08] bg-slate-100 dark:bg-[#080814] flex flex-col">
                      <PdfViewer
                        source={file.content}
                        fileName={file.name}
                        onResolvedUrl={setPdfActionUrl}
                        onPageCountChange={setPdfPageCount}
                      />
                      <div className="absolute bottom-3 left-3 right-3 bg-white/95 dark:bg-[#0E0E1D]/95 border border-slate-200 dark:border-white/10 rounded-lg px-3.5 py-2 flex items-center justify-between text-[11px] font-mono pointer-events-auto backdrop-blur-md shadow-sm">
                        <span className="text-slate-700 dark:text-slate-300 font-semibold truncate mr-3">{file.name}</span>
                        <span className="text-violet-600 dark:text-violet-400 font-semibold uppercase tracking-wider shrink-0 tabular-nums">
                          {pdfPageCount ? `${pdfPageCount} ${pdfPageCount === 1 ? "PAGE" : "PAGES"} · ` : ""}
                          {Math.round(file.size / 1024 * 10) / 10} KB · PDF
                        </span>
                      </div>
                    </div>

                  </div>
                ) : file.type && (file.type.startsWith("image/") || file.content.startsWith("data:image/")) ? (
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <img 
                      src={file.content} 
                      alt={file.name} 
                      className="max-h-[50vh] object-contain rounded-xl border border-slate-200 dark:border-white/10 shadow-md"
                      referrerPolicy="no-referrer"
                    />
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">Image format · {file.type || "Unknown type"}</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-white/[0.07] pb-2.5 tabular-nums">
                      <div className="flex items-center gap-3">
                        <span>File Size: {Math.round(file.size / 1024 * 10) / 10} KB</span>
                        {file.pageCount ? (
                          <span>
                            · {file.pageCount}{" "}
                            {file.name.toLowerCase().endsWith(".ppt") || file.name.toLowerCase().endsWith(".pptx")
                              ? file.pageCount === 1 ? "Slide" : "Slides"
                              : file.pageCount === 1 ? "Page" : "Pages"}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadOriginalFile}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-sans font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download File</span>
                      </button>
                    </div>

                    {file.content.startsWith("/api/rag/document/") ||
                    file.name.toLowerCase().endsWith(".ppt") ||
                    file.name.toLowerCase().endsWith(".pptx") ? (
                      loadingPreview ? (
                        <div className="py-10 flex flex-col items-center justify-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin text-violet-600 dark:text-violet-400" />
                          <span>Loading extracted slides & sections...</span>
                        </div>
                      ) : previewSections.length > 0 ? (
                        <div className="space-y-3">
                          {previewSections.map((sec) => (
                            <div
                              key={sec.id}
                              className="rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.03] p-4 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                  {sec.title}
                                </span>
                                <span className="text-[10px] font-mono font-semibold text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/15 px-2 py-0.5 rounded shrink-0 tabular-nums">
                                  {sec.pageStart === sec.pageEnd
                                    ? `${file.name.toLowerCase().endsWith(".ppt") || file.name.toLowerCase().endsWith(".pptx") ? "Slide" : "Page"} ${sec.pageStart}`
                                    : `${file.name.toLowerCase().endsWith(".ppt") || file.name.toLowerCase().endsWith(".pptx") ? "Slides" : "Pages"} ${sec.pageStart}–${sec.pageEnd}`}
                                </span>
                              </div>
                              <div className="text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-sans whitespace-pre-wrap leading-relaxed select-text">
                                {sec.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                          {previewError ||
                            (file.ragStage && file.ragStage !== "ready"
                              ? "Slides are currently being indexed in the background..."
                              : "No text preview available—click Download File above to open the original deck.")}
                        </div>
                      )
                    ) : (
                      <div className="text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-sans whitespace-pre-wrap leading-relaxed select-text">
                        {file.content || "Empty document content uploaded."}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Help tip footer */}
              <div className="bg-slate-50/80 dark:bg-white/[0.02] border-t border-slate-200/80 dark:border-white/[0.08] px-6 py-3 flex justify-between items-center text-[10px] font-mono text-slate-500 dark:text-slate-400 font-semibold tracking-wider" id="source-doc-footer">
                <span>PRESS ESC TO CLOSE</span>
                <span className="text-violet-600 dark:text-violet-400">FEYNMAN SOURCE VIEWER</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
    </div>
  );
}
