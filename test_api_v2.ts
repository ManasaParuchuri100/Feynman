import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function run() {
  const parts = [
    { text: "Hello! This is a test of the Feynman technique API integration." }
  ];

  console.log("Testing format 1: contents = array of parts directly");
  try {
    const res1 = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: parts,
    });
    console.log("Format 1 SUCCESS!", res1.text);
  } catch (e: any) {
    console.error("Format 1 FAILED:", e.message || e);
  }

  console.log("\nTesting format 2: contents = { parts: array of parts }");
  try {
    const res2 = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: { parts: parts },
    });
    console.log("Format 2 SUCCESS!", res2.text);
  } catch (e: any) {
    console.error("Format 2 FAILED:", e.message || e);
  }

  console.log("\nTesting format 3: contents = array of Content objects (with role)");
  try {
    const res3 = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: [{ role: "user", parts: parts }],
    });
    console.log("Format 3 SUCCESS!", res3.text);
  } catch (e: any) {
    console.error("Format 3 FAILED:", e.message || e);
  }
}

run();
