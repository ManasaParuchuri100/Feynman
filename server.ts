import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini SDK with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Helper to call Gemini API with automatic model fallback of free tier models to avoid 429 Rate Limits and 503 High Demand Errors
async function generateContentWithFallback(params: any): Promise<any> {
  try {
    return await ai.models.generateContent(params);
  } catch (error: any) {
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    console.warn(`Primary model '${params.model}' call failed. Error: ${errorMsg}`);
    
    if (params.model === "gemini-3.5-flash") {
      console.warn("Gracefully falling back to stable free-tier model 'gemini-3.1-flash-lite'...");
      const fallbackParams = {
        ...params,
        model: "gemini-3.1-flash-lite"
      };
      try {
        return await ai.models.generateContent(fallbackParams);
      } catch (fallbackError: any) {
        console.error("Fallback model 'gemini-3.1-flash-lite' also failed:", fallbackError.message || fallbackError);
        throw fallbackError;
      }
    }
    throw error;
  }
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 1. Concept Extraction API
app.post("/api/document/concepts", async (req, res) => {
  try {
    const { fileName, fileType, fileContent } = req.body;

    if (!fileContent) {
      return res.status(400).json({ error: "Missing file content" });
    }

    let contents: any[] = [];
    let promptText = `
      You are an expert tutor specializing in the Feynman Technique ("teach it to learn it").
      You have been given a document named "${fileName}" of type "${fileType}".
      
      CRITICAL RULE: Rely ONLY on the information explicitly contained in the provided document. Do NOT introduce or assume external knowledge, facts, definitions, or secondary context not stated in the document. All extracted topics and summaries must be 100% grounded in and traceable to the provided content. If the document content is extremely short or simple, extract only the topics that can be rigorously justified from the text, even if that results in fewer than 4 topics (e.g., 1 to 3 topics). Do not add any extra, fabricated, or external details.

      Your task is to analyze this content and extract 4 to 6 core scientific, academic, or professional concepts (or fewer, if the text is short) that a student can study and explain back to you.
      For each concept, provide:
      1. A clear, concise 'title' direct from the text.
      2. The 'difficulty' (one of: 'Easy', 'Medium', 'Hard').
      3. A high-level 'summary' of what the concept means, based strictly on the provided content.
      4. A welcoming and specific 'suggestedExplanationPrompt' asking the student to teach you this, formulated strictly from the facts in the document.
    `;

    const isBinaryOrImage = fileType.startsWith("image/") || fileType === "application/pdf" || fileContent.startsWith("data:application/pdf");

    if (isBinaryOrImage) {
      // It's an image or PDF input passed as base64
      const base64Data = fileContent.split(",")[1] || fileContent;
      const mime = fileContent.startsWith("data:") 
        ? (fileContent.substring(5, fileContent.indexOf(";")) || fileType)
        : fileType;

      contents = [
        {
          inlineData: {
            mimeType: mime,
            data: base64Data,
          },
        },
        { text: promptText },
      ];
    } else {
      // It's text/markdown/csv or plain string
      contents = [
        {
          text: `Here is the content of the document:\n\n${fileContent}\n\n${promptText}`,
        },
      ];
    }

    const response = await generateContentWithFallback({
      model: "gemini-3.5-flash",
      contents: { parts: contents },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            concepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  difficulty: { type: Type.STRING, description: "Easy, Medium, or Hard" },
                  summary: { type: Type.STRING },
                  suggestedExplanationPrompt: { type: Type.STRING },
                },
                required: ["title", "difficulty", "summary", "suggestedExplanationPrompt"],
              },
            },
          },
          required: ["concepts"],
        },
      },
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("No response text from Gemini");
    }

    const result = JSON.parse(textOutput.trim());
    res.json(result);
  } catch (error: any) {
    console.error("Error in extracting concepts:", error);
    res.status(500).json({ error: error.message || "Failed to extract concepts" });
  }
});

// 2. Feynman Evaluation and Response API
app.post("/api/feynman/evaluate", async (req, res) => {
  try {
    const { conceptTitle, conceptSummary, userExplanation, previousChat, originalContent, fileType, userDrawings } = req.body;

    if (!conceptTitle || !userExplanation) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const chatContext = previousChat && previousChat.length > 0
      ? previousChat.map((m: any) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.text}`).join("\n")
      : "No previous discussion.";

    const promptText = `
      You are Feynman, an intelligent and extremely curious student learning about "${conceptTitle}".
      Your goal is to apply the Feynman Technique ("teach it to learn it") to help the teacher (the human user) master this concept by explaining it simply.
      
      CRITICAL RULE: Evaluate and respond based ONLY on the provided original source document/material and the concept definitions. Do NOT bring in any outside knowledge, secondary context, or details not present in the original document. Any follow-up questions or observations must be strictly traceable to facts explicitly present in the provided content. Do not fabricate facts.

      Concept context/definition: "${conceptSummary}"
      Current concept being taught: "${conceptTitle}"
      
      Conversation history:
      ${chatContext}
      
      User's Explanation/Teaching (including text and voice):
      "${userExplanation}"
      
      Your task:
      1. Compare the user's explanation directly with the provided original source document/material and the concept definitions.
      2. Carefully assess the explanation. Be supportive, constructive, and highly conversational.
      
      CRITICAL EVALUATION RUBRIC & DETERMINISTIC SCORING RULES:
      Evaluate active user understanding shown in their text, voice transcripts, and board sketch data. You must rate the explanation from 0 to 100 on these four criteria:
         - 'clarity': Is it easy to follow and coherent?
         - 'accuracy': Is it scientifically and factually correct based on the original source document and diagrams?
         - 'simplicity': Does it avoid complex technical jargon or translate it into metaphors that a 10-year-old child can understand?
         - 'completeness': Does it cover all details, key terms, or nuances present in the original source material regarding "${conceptTitle}"?

      CRITICAL SCORE SCALE:
         - EXTREMELY LOW UNDERSTANDING (Score: 0 to 20): The user's input/explanation is empty, extremely short (under 15 words), contains only noise/greetings (e.g., "hi", "hello", "skip", "test"), or says they don't know (e.g. "I don't know", "can you teach me"). Assign a score of 0 to 20 across all four metrics. NEVER give a grade above 25 if there is no actual explanation attempt.
         - WEAK/SUPERFICIAL UNDERSTANDING (Score: 21 to 55): User makes an attempt but provides mostly incorrect information, repeats terms without explaining them, or has severe misconceptions compared to the source material.
         - MODERATE/PARTIAL UNDERSTANDING (Score: 56 to 79): User explains parts of the concept correctly but leaves out key definitions, mechanisms, or relationships. Or they explain it correctly but rely purely on copying direct dense jargon without simplifying it (capping simplicity < 60).
         - STRONG/COMPLETE UNDERSTANDING (Score: 80 to 100): User teaches the concept completely, accurately, and explains it in a highly simplified and crystal-clear way. High scores (e.g. 80-100) are reserved for genuine evidence of deep understanding.

      3. Support pictures and drawings:
         - Analyze hand-drawn whiteboard sketches or diagram segments (supplied as base64 images).
         - Grade these drawings solely on their CONCEPTUAL UNDERSTANDING and logical core ideas (e.g., direction of flow, connections), NOT on pixel-to-pixel matches, artistic skill, or visual perfection.
      4. Identify 'gaps': Specific missing points, factually incorrect statements, or unexplained jargon, directly referenced and compared against the uploaded original source. Mention specifically what was present in the original source document but was missing or forgotten from their explanation of "${conceptTitle}".
      5. Write 'feedbackText' as Feynman the student. Keep it in character: curious, friendly, and asking a gentle but sharp follow-up question.
         
         CRITICAL REQUIREMENT: The follow-up question in 'feedbackText' MUST be explicitly and dynamically formulated based on BOTH the specific sub-topic/concept "${conceptTitle}" being discussed AND the user's determined grading scores you just calculated:
         - If 'accuracy' is lower (< 80): Ask a clarification question targeting a factually weak, incorrect, or suspect statement in their explanation or drawing relative to the original source.
         - If 'completeness' is lower (< 80): Pose a question about a major section, formula, or detail from the original document that the user omitted or forgot to explain.
         - If 'simplicity' is lower (< 80): Ask them if they can build or share a simple, playful metaphor or everyday analogy to demystify the complex technical jargon they used.
         - If 'clarity' is lower (< 80): Ask them if they can break down their explanation stage-by-stage or clarify the logical connection between two of their points.
         - If all scores are high (>= 80): Celebrate their teaching mastery, and ask a creative "what-if" or advanced scenario-based question also directly grounded in the original source material to stimulate further thinking.

         The question must feel like a natural student question, and must directly reference and acknowledge any custom hand-drawn whiteboard sketches, diagram segments, or specific terminology they taught.
      6. Provide dry 'suggestions' for how they can simplify or expand their explanation or whiteboard drawing next time to fill the gaps.
    `;

    let contents: any[] = [];

    const isImage = !!(fileType && (
      fileType.startsWith("image/") || 
      (typeof originalContent === "string" && originalContent.startsWith("data:image/"))
    ));

    if (isImage && typeof originalContent === "string" && originalContent) {
      const base64Data = originalContent.split(",")[1] || originalContent;
      const mime = originalContent.startsWith("data:") 
        ? (originalContent.substring(5, originalContent.indexOf(";")) || fileType)
        : fileType;

      contents.push({
        inlineData: {
          mimeType: mime,
          data: base64Data,
        },
      });
    } else if (originalContent && !originalContent.startsWith("data:application/pdf") && fileType !== "application/pdf") {
      // Truncate original content slightly if extremely long to improve api response time and prevent token overhead
      const maxCharCount = 15000;
      const truncatedDoc = originalContent.length > maxCharCount
        ? originalContent.substring(0, maxCharCount) + "\n[Content truncated for system evaluation performance]"
        : originalContent;
      const docContext = `Here is the complete original source document context:\n\n${truncatedDoc}\n\n`;
      contents.push({ text: docContext });
    } else {
      // For large PDFs, we pass the extracted concept and summary as the primary reference text to avoid sending megabytes of base64 data on every run
      const docContext = `Here is the extracted reference context for this topic:\nConcept: ${conceptTitle}\nSummary & Key Details: ${conceptSummary}\n`;
      contents.push({ text: docContext });
    }

    // Append hand-drawn whiteboard drawing segments as inlineData image objects for Gemini to inspect
    if (userDrawings && Array.isArray(userDrawings) && userDrawings.length > 0) {
      userDrawings.forEach((dataUrl: string) => {
        if (!dataUrl) return;
        const base64Data = dataUrl.split(",")[1] || dataUrl;
        const mime = dataUrl.startsWith("data:") 
          ? (dataUrl.substring(5, dataUrl.indexOf(";")) || "image/png")
          : "image/png";
        contents.push({
          inlineData: {
            mimeType: mime,
            data: base64Data,
          }
        });
      });
    }

    // Append the primary evaluation prompt text
    contents.push({ text: promptText });

    const response = await generateContentWithFallback({
      model: "gemini-3.5-flash",
      contents: { parts: contents },
      config: {
        temperature: 0.1, // Lower temperature to ensure stable, non-random, deterministic grading scores
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            feedbackText: { type: Type.STRING, description: "Curious, supportive response in character as Feynman the student, with a follow-up question strictly based on the original document content." },
            clarity: { type: Type.NUMBER, description: "Clarity score (0-100)" },
            accuracy: { type: Type.NUMBER, description: "Accuracy score based on the original document (0-100)" },
            simplicity: { type: Type.NUMBER, description: "Simplicity/10-year-old match score (0-100)" },
            completeness: { type: Type.NUMBER, description: "Completeness score assessing coverage compared to the original document details (0-100)" },
            gaps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of identified gaps, missing points or unexplained jargon relative to the original source text." },
            suggestions: { type: Type.STRING, description: "Actionable simplification and expansion tips related to the original document content" },
          },
          required: ["feedbackText", "clarity", "accuracy", "simplicity", "completeness", "gaps", "suggestions"],
        },
      },
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("No response text from Gemini");
    }

    const result = JSON.parse(textOutput.trim());
    res.json(result);
  } catch (error: any) {
    console.error("Error in Feynman evaluation:", error);
    res.status(500).json({ error: error.message || "Failed to evaluate explanation" });
  }
});

// Vite & Static Asset Handling
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
