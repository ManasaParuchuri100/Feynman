import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type {
  DocumentStructure,
  ParentChunk,
  RagConcept,
} from "./types.ts";
import {
  computeVectorNorm,
  getCachedEmbedding,
  setCachedEmbeddings,
  sha256Hex,
} from "./vectorStore.ts";

export const EMBEDDING_MODEL = "gemini-embedding-2";
export const PRIMARY_MODEL = "gemini-4-hydrogen";
export const PREPROCESS_MODEL = "gemini-3.1-flash-lite";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.error?.code;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("unavailable") ||
    msg.includes("timeout") ||
    msg.includes("econnreset")
  );
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; timeoutMs?: number; label?: string } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 800;
  const timeoutMs = options.timeoutMs ?? 35000;
  const label = options.label ?? "Gemini API call";

  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (err: any) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryableError(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function generateWithPrimaryFallback(params: {
  model?: string;
  contents: any;
  config?: any;
  label?: string;
  timeoutMs?: number;
}): Promise<any> {
  const primaryModel = params.model || PRIMARY_MODEL;
  try {
    return await retryWithBackoff(
      () =>
        ai.models.generateContent({
          model: primaryModel,
          contents: params.contents,
          config: params.config,
        }),
      { maxAttempts: 2, timeoutMs: params.timeoutMs ?? 22000, label: params.label || primaryModel }
    );
  } catch (err: any) {
    if (primaryModel !== PREPROCESS_MODEL) {
      console.warn(
        `Primary model '${primaryModel}' failed (${err?.message || err}); falling back to '${PREPROCESS_MODEL}'.`
      );
      return await retryWithBackoff(
        () =>
          ai.models.generateContent({
            model: PREPROCESS_MODEL,
            contents: params.contents,
            config: {
              ...(params.config || {}),
              ...(params.config?.thinkingConfig
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          }),
        { maxAttempts: 2, timeoutMs: params.timeoutMs ?? 25000, label: PREPROCESS_MODEL }
      );
    }
    throw err;
  }
}

/**
 * Generates embeddings in batches with SQLite text-hash caching and bounded concurrency.
 */
export async function embedTextsWithCache(
  texts: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<Array<{ vector: Float32Array; norm: number }>> {
  const results: Array<{ vector: Float32Array; norm: number } | null> = new Array(
    texts.length
  ).fill(null);

  const missingIndices: number[] = [];
  const hashes = texts.map((t) => sha256Hex(`${EMBEDDING_MODEL}::${t.trim()}`));

  let resolvedCount = 0;
  for (let i = 0; i < texts.length; i++) {
    const cached = getCachedEmbedding(hashes[i], EMBEDDING_MODEL);
    if (cached && cached.length > 0) {
      results[i] = { vector: cached, norm: computeVectorNorm(cached) };
      resolvedCount++;
    } else {
      missingIndices.push(i);
    }
  }

  if (onProgress) {
    onProgress(resolvedCount, texts.length);
  }

  if (missingIndices.length > 0) {
    const BATCH_SIZE = 32;
    const CONCURRENCY = 2;
    const batches: number[][] = [];
    for (let i = 0; i < missingIndices.length; i += BATCH_SIZE) {
      batches.push(missingIndices.slice(i, i + BATCH_SIZE));
    }

    let nextBatchIdx = 0;
    const worker = async () => {
      while (nextBatchIdx < batches.length) {
        const myIdx = nextBatchIdx++;
        const idxBatch = batches[myIdx];
        const batchContents = idxBatch.map((idx) => ({
          role: "user",
          parts: [{ text: texts[idx].slice(0, 7500) }],
        }));

        const response = await retryWithBackoff(
          () =>
            ai.models.embedContent({
              model: EMBEDDING_MODEL,
              contents: batchContents,
            }),
          { maxAttempts: 3, baseDelayMs: 900, timeoutMs: 30000, label: "Embedding batch" }
        );

        const embeddings = response.embeddings || [];
        if (embeddings.length !== idxBatch.length) {
          throw new Error(
            `Embedding count mismatch: expected ${idxBatch.length}, got ${embeddings.length}`
          );
        }

        const toCache: Array<{
          textHash: string;
          model: string;
          embedding: Float32Array;
        }> = [];

        for (let k = 0; k < idxBatch.length; k++) {
          const origIdx = idxBatch[k];
          const values = embeddings[k]?.values;
          if (!values || values.length === 0) {
            throw new Error(`Empty embedding returned for chunk index ${origIdx}`);
          }
          const vec = new Float32Array(values);
          results[origIdx] = { vector: vec, norm: computeVectorNorm(vec) };
          toCache.push({
            textHash: hashes[origIdx],
            model: EMBEDDING_MODEL,
            embedding: vec,
          });
          resolvedCount++;
        }

        setCachedEmbeddings(toCache);
        if (onProgress) {
          onProgress(resolvedCount, texts.length);
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker());
    await Promise.all(workers);
  }

  return results.map((item) => {
    if (!item) {
      throw new Error("Missing embedding vector after batch processing");
    }
    return item;
  });
}

/**
 * Extracts readable structured text from an uploaded slide/image once during ingestion.
 */
export async function transcribeImageStudyMaterial(
  base64Data: string,
  mimeType: string,
  fileName: string
): Promise<string> {
  const response = await generateWithPrimaryFallback({
    model: PREPROCESS_MODEL,
    label: "Image study material extraction",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text: `Transcribe all visible text, headings, formulas, tables, labels, and diagram relationships from this study image ("${fileName}") cleanly in Markdown format. Preserve exact terms and mathematical notation without adding outside facts.`,
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });

  return (response.text || "").trim() || `Study slide image: ${fileName}`;
}

/**
 * Generates and caches a compact document overview, chapter hierarchy, concepts, and key definitions
 * using a structural skeleton sampled from parent chunks (never sending the full raw PDF binary).
 */
export async function extractDocumentStructure(params: {
  fileName: string;
  pageCount: number;
  parents: ParentChunk[];
  detectedHeadings: Array<{ title: string; pageNumber: number }>;
}): Promise<DocumentStructure> {
  const { fileName, pageCount, parents, detectedHeadings } = params;

  // Select representative parent sections evenly distributed from start to end (~20k char budget)
  const MAX_OUTLINE_CHARS = 20000;
  const maxSnippets = Math.min(parents.length, 28);
  const step = parents.length > maxSnippets ? parents.length / maxSnippets : 1;
  const sampledParents: ParentChunk[] = [];
  for (let i = 0; i < maxSnippets; i++) {
    const idx = Math.min(parents.length - 1, Math.floor(i * step));
    if (!sampledParents.includes(parents[idx])) {
      sampledParents.push(parents[idx]);
    }
  }

  const perSectionBudget = Math.max(
    260,
    Math.floor(MAX_OUTLINE_CHARS / Math.max(1, sampledParents.length))
  );

  const structuralDigest = sampledParents
    .map((p) => {
      const snippet = p.text.slice(0, perSectionBudget).replace(/\s+/g, " ").trim();
      return `[Section: ${p.sectionTitle} | Pages ${p.pageStart}-${p.pageEnd}]\n${snippet}`;
    })
    .join("\n\n");

  const headingList = detectedHeadings
    .slice(0, 60)
    .map((h) => `- ${h.title} (p. ${h.pageNumber})`)
    .join("\n");

  const prompt = `
You are analyzing a study document named "${fileName}" (${pageCount} pages) for an active-recall Feynman learning workspace.
Below is the extracted structural outline and representative section excerpts with exact page numbers.

CRITICAL RULE: Ground EVERY topic, summary, chapter, and definition strictly in the provided document excerpts. Do NOT invent outside facts.

Detected Headings:
${headingList || "(No explicit headings detected; infer logical sections from content)"}

Section Excerpts:
${structuralDigest}

Produce a structured JSON object containing:
1. "overview": A concise 2-3 sentence overview of what this document covers.
2. "chapters": 2 to 8 major chapters/sections with accurate "title", "pageStart", "pageEnd", concise "summary", and 2-5 "keyTerms".
3. "concepts": 4 to 7 core study concepts (or 1 to 3 if the document is very short) for the student to teach back using the Feynman Technique. Include accurate "pageStart", "pageEnd", "sectionTitle", "difficulty" ('Easy' | 'Medium' | 'Hard'), "summary", and a welcoming "suggestedExplanationPrompt".
4. "keyDefinitions": Up to 8 key terms/formulas defined in the document with "term", "definition", and "pageNumber".
`;

  const response = await generateWithPrimaryFallback({
    model: PREPROCESS_MODEL,
    label: "Document structure extraction",
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overview: { type: Type.STRING },
          chapters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                pageStart: { type: Type.INTEGER },
                pageEnd: { type: Type.INTEGER },
                summary: { type: Type.STRING },
                keyTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["title", "pageStart", "pageEnd", "summary", "keyTerms"],
            },
          },
          concepts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                summary: { type: Type.STRING },
                suggestedExplanationPrompt: { type: Type.STRING },
                pageStart: { type: Type.INTEGER },
                pageEnd: { type: Type.INTEGER },
                sectionTitle: { type: Type.STRING },
              },
              required: [
                "title",
                "difficulty",
                "summary",
                "suggestedExplanationPrompt",
                "pageStart",
                "pageEnd",
                "sectionTitle",
              ],
            },
          },
          keyDefinitions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                definition: { type: Type.STRING },
                pageNumber: { type: Type.INTEGER },
              },
              required: ["term", "definition", "pageNumber"],
            },
          },
        },
        required: ["overview", "chapters", "concepts", "keyDefinitions"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());

  const concepts: RagConcept[] = (Array.isArray(parsed.concepts) ? parsed.concepts : []).map(
    (c: any, idx: number) => ({
      id: `concept_${idx + 1}`,
      title: String(c.title || `Concept ${idx + 1}`),
      difficulty:
        c.difficulty === "Easy" || c.difficulty === "Hard" ? c.difficulty : "Medium",
      summary: String(c.summary || ""),
      suggestedExplanationPrompt: String(
        c.suggestedExplanationPrompt ||
          `Teach me "${c.title || "this concept"}" in simple everyday language.`
      ),
      pageStart: Number(c.pageStart) || 1,
      pageEnd: Number(c.pageEnd) || Number(c.pageStart) || 1,
      sectionTitle: String(c.sectionTitle || ""),
    })
  );

  return {
    overview: String(parsed.overview || `Study material extracted from ${fileName}.`),
    chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
    concepts,
    keyDefinitions: Array.isArray(parsed.keyDefinitions) ? parsed.keyDefinitions : [],
  };
}

/**
 * Evaluates a user's Feynman explanation using ONLY the retrieved relevant chunks & adjacent context.
 */
export async function evaluateFeynmanWithRag(params: {
  conceptTitle: string;
  conceptSummary: string;
  userExplanation: string;
  retrievedContext: string;
  previousChat?: Array<{ role: string; text: string }>;
  userDrawings?: string[];
}): Promise<{
  feedbackText: string;
  clarity: number;
  accuracy: number;
  simplicity: number;
  completeness: number;
  gaps: string[];
  suggestions: string;
}> {
  const {
    conceptTitle,
    conceptSummary,
    userExplanation,
    retrievedContext,
    previousChat = [],
    userDrawings = [],
  } = params;

  const chatContext =
    previousChat.length > 0
      ? previousChat
          .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.text}`)
          .join("\n")
      : "No previous discussion.";

  const promptText = `
You are Feynman, an intelligent and deeply curious student learning about "${conceptTitle}".
Your goal is to apply the Feynman Technique ("teach it to learn it") to help the teacher (the human user) master "${conceptTitle}" by explaining it simply.

CRITICAL GROUNDING RULES:
1. Evaluate and respond based ONLY on the retrieved source passages below for "${conceptTitle}".
2. Do NOT penalize the user for omitting unrelated information from other chapters or sections of the document that are outside "${conceptTitle}".
3. Do NOT introduce external facts not present in the retrieved source passages.
4. When pointing out gaps or asking a follow-up question, cite the relevant page numbers (e.g., "p. 12") from the retrieved passages where appropriate.

Target Concept: "${conceptTitle}"
Concept Summary: "${conceptSummary}"

Retrieved Source Passages (with Section & Page Metadata):
${retrievedContext}

Conversation History:
${chatContext}

User's Explanation/Teaching:
"${userExplanation}"

Scoring Rubric (0 to 100 on each):
- 'clarity': Coherence and step-by-step logical flow.
- 'accuracy': Factual correctness against the retrieved source passages and any diagrams/sketches.
- 'simplicity': Translates technical jargon into intuitive everyday language/analogies a 10-year-old could grasp.
- 'completeness': Covers the essential mechanisms, definitions, or formulas for "${conceptTitle}" present in the retrieved passages (without penalizing for unrelated document sections).

Score Calibration:
- 0-20: Empty, under 15 words, noise/greetings, or "I don't know".
- 21-55: Superficial attempt, major inaccuracies, or buzzword repetition without explanation.
- 56-79: Partially accurate but omits key mechanisms from the retrieved context or uses unexplained dense jargon (cap simplicity < 60).
- 80-100: Accurate, complete for this concept, clear, and genuinely simplified.

Provide:
- 'gaps': Specific missing details, misconceptions, or unexplained jargon compared against the retrieved source passages (cite page numbers when available).
- 'feedbackText': Curious, friendly in-character response from Feynman with one targeted follow-up question tailored to the lowest-scoring dimension (or an advanced "what-if" grounded in the retrieved passages if all scores >= 80). Reference any whiteboard drawings if supplied.
- 'suggestions': Actionable advice for simplifying or filling the identified gaps.
`;

  const parts: any[] = [{ text: promptText }];

  if (Array.isArray(userDrawings) && userDrawings.length > 0) {
    for (const dataUrl of userDrawings) {
      if (!dataUrl) continue;
      const base64Data = dataUrl.split(",")[1] || dataUrl;
      const mime = dataUrl.startsWith("data:")
        ? dataUrl.substring(5, dataUrl.indexOf(";")) || "image/png"
        : "image/png";
      parts.push({
        inlineData: {
          mimeType: mime,
          data: base64Data,
        },
      });
    }
  }

  const response = await generateWithPrimaryFallback({
    model: PRIMARY_MODEL,
    label: "Feynman RAG evaluation",
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          feedbackText: { type: Type.STRING },
          clarity: { type: Type.NUMBER },
          accuracy: { type: Type.NUMBER },
          simplicity: { type: Type.NUMBER },
          completeness: { type: Type.NUMBER },
          gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: { type: Type.STRING },
        },
        required: [
          "feedbackText",
          "clarity",
          "accuracy",
          "simplicity",
          "completeness",
          "gaps",
          "suggestions",
        ],
      },
    },
  });

  const textOutput = response.text;
  if (!textOutput) {
    throw new Error("Empty evaluation response from Gemini");
  }
  return JSON.parse(textOutput.trim());
}

/**
 * Generates contextual MCQ & Fill-in-the-blank flashcards strictly grounded in retrieved chunks.
 */
export async function generateFlashcardsWithRag(params: {
  fileName: string;
  concepts: Array<{ title: string; summary: string }>;
  groundedContext: string;
}): Promise<any[]> {
  const prompt = `
You are an engaging active-recall quiz designer for FEYNMAN.
Using ONLY the grounded source passages and extracted concepts below from "${params.fileName}", generate 6 to 8 fun, thought-provoking flashcards alternating between "mcq" and "fill_blank".

CRITICAL RULES FOR OPTIONS:
- Every card MUST have 4 plausible, contextually relevant answer choices in "options" (1 exact "answer" + 3 realistic distractors grounded in the domain—NEVER just generic topic names or unrelated filler).
- Make questions fun, crisp, and conceptual (testing why/how mechanisms work, formulas, or edge cases, not trivial trivia).
- Include "explainWhy" (referencing the source logic/page) and "whatAbout" (why distractors fall short or a bonus intuition).

Extracted Concepts:
${params.concepts.map((c) => `- ${c.title}: ${c.summary}`).join("\n")}

Grounded Source Passages:
${params.groundedContext}
`;

  const response = await generateWithPrimaryFallback({
    model: PREPROCESS_MODEL,
    label: "RAG flashcard generation",
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          flashcards: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                conceptTitle: { type: Type.STRING },
                cardType: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                question: { type: Type.STRING },
                answer: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                explainWhy: { type: Type.STRING },
                whatAbout: { type: Type.STRING },
              },
              required: [
                "conceptTitle",
                "cardType",
                "difficulty",
                "question",
                "answer",
                "options",
                "explainWhy",
                "whatAbout",
              ],
            },
          },
        },
        required: ["flashcards"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());
  return Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
}

/**
 * Curates contextual external study resources grounded in document topics and retrieved chunks.
 */
export async function curateSourcesWithRag(params: {
  fileName: string;
  concepts: Array<{ title: string; summary: string }>;
  groundedContext: string;
  searchQuery?: string;
}): Promise<{
  aiExplanation: string;
  topics: string[];
  resources: Array<{
    id: string;
    title: string;
    description: string;
    url: string;
    source: string;
    type: "Articles" | "Documentation" | "Videos" | "Research Papers" | "Further Reading";
    relevanceReason: string;
  }>;
}> {
  const prompt = `
You are curating reliable, directly relevant external study resources for a student studying "${params.fileName}" on FEYNMAN.
${params.searchQuery ? `The student specifically asked to focus on: "${params.searchQuery}".` : ""}

Topics from the document:
${params.concepts.map((c) => `- ${c.title}: ${c.summary}`).join("\n")}

Retrieved Grounded Passages:
${params.groundedContext}

Recommend 6 to 8 high-quality, real, well-known educational resources across the categories:
"Articles", "Documentation", "Videos", "Research Papers", "Further Reading".

Prioritize authoritative URLs from well-known institutions and official docs (e.g., Wikipedia, Khan Academy, MIT OpenCourseWare, Stanford CS, Scikit-learn, PyTorch, TensorFlow, MDN, arXiv, Nature, IEEE, NIST, 3Blue1Brown, etc.) that match the EXACT concepts in the passages—never generic unrelated filler.
Use direct stable URLs that exist on those platforms (no fabricated random URL paths).
`;

  const response = await generateWithPrimaryFallback({
    model: PRIMARY_MODEL,
    label: "RAG curated sources",
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          aiExplanation: { type: Type.STRING },
          topics: { type: Type.ARRAY, items: { type: Type.STRING } },
          resources: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                url: { type: Type.STRING },
                source: { type: Type.STRING },
                type: { type: Type.STRING },
                relevanceReason: { type: Type.STRING },
              },
              required: [
                "id",
                "title",
                "description",
                "url",
                "source",
                "type",
                "relevanceReason",
              ],
            },
          },
        },
        required: ["aiExplanation", "topics", "resources"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());
  const validCategories = new Set([
    "Articles",
    "Documentation",
    "Videos",
    "Research Papers",
    "Further Reading",
  ]);

  const resources = (Array.isArray(parsed.resources) ? parsed.resources : []).map(
    (r: any, idx: number) => ({
      id: String(r.id || `src_${idx + 1}`),
      title: String(r.title || "Educational Reference"),
      description: String(r.description || ""),
      url: String(r.url || "https://en.wikipedia.org"),
      source: String(r.source || "Reference"),
      type: validCategories.has(r.type) ? r.type : "Articles",
      relevanceReason: String(r.relevanceReason || ""),
    })
  );

  return {
    aiExplanation: String(
      parsed.aiExplanation ||
        "These resources were selected directly from the core concepts and passages in your uploaded notes."
    ),
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    resources,
  };
}
