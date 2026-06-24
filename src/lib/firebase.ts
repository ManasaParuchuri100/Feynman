import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc, query, where } from "firebase/firestore";
import { UserProfile, UploadedFile, Concept } from "../types";

const firebaseConfig = {
  projectId: "feynman-43651",
  appId: "1:899072823850:web:81d55988799e3dbc522953",
  apiKey: "AIzaSyAQiU6n9QOgC81GNmzfZnciAnUygGm9XHk",
  authDomain: "feynman-43651.firebaseapp.com",
  firestoreDatabaseId: "feynman",
  storageBucket: "feynman-43651.firebasestorage.app",
  messagingSenderId: "899072823850",
  measurementId: ""
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Initialize Cloud Firestore with custom database ID 'feynman'
export const db = getFirestore(app, "feynman");

// Re-export Auth helper methods for centralized consumption and safety
export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
  onAuthStateChanged
};

export type { FirebaseUser };

// Fetch a user's profile from Firestore
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const userRef = doc(db, "users", uid);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      return userDoc.data() as UserProfile;
    }
  } catch (error) {
    console.error("Error fetching user profile:", error);
  }
  return null;
}

// Ensure user profile exists in Firestore, create it with initial fields if not, otherwise update lastLogin
export async function syncUserProfile(
  uid: string,
  email: string,
  name: string = "",
  photoURL: string = ""
): Promise<UserProfile> {
  const userRef = doc(db, "users", uid);
  const nowStr = new Date().toISOString();
  
  try {
    // Seed default subcollections to ensure they exist and appear instantly in Firestore console
    await seedDefaultSubcollections(uid);

    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      const existingData = userDoc.data() as UserProfile;
      // Update lastLogin
      await updateDoc(userRef, {
        lastLogin: nowStr,
        name: existingData.name || name,
        photoURL: existingData.photoURL || photoURL
      });
      return {
        ...existingData,
        lastLogin: nowStr,
        name: existingData.name || name,
        photoURL: existingData.photoURL || photoURL
      };
    } else {
      // Create new profile record matching the user's requested screenshot fields exactly
      const newProfile: UserProfile = {
        uid,
        name,
        email,
        photoURL,
        streak: 1,
        avgMastery: 85,
        totalTopicsMastered: 0,
        topicsMastered: 0,
        totalTimeStudied: 120, // default starter placeholder matching dashboard UI
        createdAt: nowStr,
        lastLogin: nowStr,
        settings: {}
      };
      await setDoc(userRef, newProfile);
      return newProfile;
    }
  } catch (error) {
    console.error("Error syncing user profile:", error);
    return {
      uid,
      name,
      email,
      photoURL,
      streak: 1,
      avgMastery: 85,
      totalTopicsMastered: 0,
      topicsMastered: 0,
      totalTimeStudied: 120,
      createdAt: nowStr,
      lastLogin: nowStr,
      settings: {}
    };
  }
}

// Seed the requested subcollection structure matching the requested diagram hierarchy exactly
export async function seedDefaultSubcollections(uid: string): Promise<void> {
  try {
    const uploadId = "welcome_guide_doc";
    
    // 1. Seed Uploads
    await saveUploadedFileToFirestore(
      uid, 
      uploadId, 
      "Feynman Welcome Guide.txt", 
      "Welcome to the Feynman Study Arena! Use this interactive space to explain complex concepts in your own words. Receive AI-powered feedback customized in character as Richard Feynman himself.",
      JSON.stringify([{ id: "feynman_intro", title: "The Feynman Technique", difficulty: "Easy", summary: "Learn by teaching." }]),
      [{ id: "feynman_intro", title: "The Feynman Technique", difficulty: "Easy", summary: "Learn by teaching." }]
    );

    // 2. Seed Topics
    await saveTopicToFirestore(uid, {
      id: "feynman_intro",
      title: "The Feynman Technique",
      difficulty: "Easy",
      summary: "Underlying principles of teaching a concept back in simple terms, identifying gaps in active comprehension.",
      suggestedExplanationPrompt: "Write a high-yield summary of the Feynman technique including the 4 primary steps",
      uploadId: uploadId,
      masteryScore: 85
    });

        // 3. Seed Explanations
    const explanationId = "default_exp_1";
    await saveExplanationToFirestore(uid, explanationId, {
      conceptTitle: "The Feynman Technique",
      userExplanation: "The Feynman Technique is a mental model for rapid learning: 1. Choose a concept. 2. Explain it to a child. 3. Pinpoint your gaps. 4. Simplify and refine your story.",
      score: 85,
      clarity: 90,
      accuracy: 85,
      simplicity: 88,
      completeness: 82,
      uploadId: uploadId,
      topicId: "feynman_intro"
    });

    // 4. Seed Feedback
    await saveFeedbackToFirestore(uid, "default_feed_1", {
      explanationId: explanationId,
      conceptTitle: "The Feynman Technique",
      suggestions: "Provide a simple real-world analogy to illustrate the technique's transition of complex jargon into normal wording.",
      feedbackText: "Feynman comments: You laid out the steps beautiful, crisp, and direct! But how would you describe step 2 in an evocative shape to a middle-schooler?",
      gaps: ["Analogies for the simplification process."],
      uploadId: uploadId,
      topicId: "feynman_intro"
    });

    // 5. Seed Achievements
    await saveAchievementToFirestore(uid, "ach_welcome", {
      title: "Welcome to the Arena",
      description: "Successfully prepared, bootstrapped and initiated the Feynman technique study environment.",
      unlockedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to seed default subcollections on sync:", error);
  }
}

// Update specific user stats (e.g. on mastering topics or studying)
export async function updateUserProfileStats(
  uid: string,
  stats: Partial<UserProfile>
): Promise<void> {
  try {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, stats);
  } catch (error) {
    console.error("Error updating user stats in Firestore:", error);
  }
}

// --- SUBCOLLECTIONS HELPERS MATCHING DIAGRAM HIERARCHY ---

// 1. UPLOADS (Nested subcollection users/{uid}/uploads/{uploadId} matching diagram hierarchy exactly)
export async function saveUploadedFileToFirestore(
  uid: string,
  fileId: string,
  fileName: string,
  fileUrl: string, // stores file contents / file payload
  knowledgeMapOrExtractedTopics: any = "",
  extractedTopicsParam: any[] = []
): Promise<void> {
  try {
    let extractedTopics = extractedTopicsParam;
    if (Array.isArray(knowledgeMapOrExtractedTopics)) {
      extractedTopics = knowledgeMapOrExtractedTopics;
    } else if (typeof knowledgeMapOrExtractedTopics === "string" && knowledgeMapOrExtractedTopics.trim().startsWith("[")) {
      try {
        extractedTopics = JSON.parse(knowledgeMapOrExtractedTopics);
      } catch (e) {
        // use default
      }
    }

    const fileType = fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain";
    const fileRef = doc(db, "users", uid, "uploads", fileId);
    
    await setDoc(fileRef, {
      fileName,
      fileType,
      fileUrl,
      uploadedAt: new Date().toISOString(),
      extractedTopicsCount: extractedTopics ? extractedTopics.length : 0,
      knowledgeMap: typeof knowledgeMapOrExtractedTopics === "string" ? knowledgeMapOrExtractedTopics : JSON.stringify(extractedTopics)
    }, { merge: true });
  } catch (error) {
    console.error("Error saving uploaded file:", error);
  }
}

export async function deleteUploadedFileFromFirestore(
  uid: string,
  fileId: string
): Promise<void> {
  try {
    const fileRef = doc(db, "users", uid, "uploads", fileId);
    await deleteDoc(fileRef);
  } catch (error) {
    console.error("Error deleting uploaded file:", error);
  }
}

export async function getUploadedFilesFromFirestore(uid: string): Promise<UploadedFile[]> {
  try {
    const uploadsColl = collection(db, "users", uid, "uploads");
    const snapshot = await getDocs(uploadsColl);
    const filesList: UploadedFile[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      filesList.push({
        id: docSnap.id,
        name: data.fileName || "Unnamed file",
        content: data.fileUrl || "",
        size: data.fileUrl ? data.fileUrl.length : 0,
        type: data.fileType || (data.fileName?.toLowerCase()?.endsWith(".pdf") ? "application/pdf" : "text/plain"),
        uploadedAt: data.uploadedAt || new Date().toISOString(),
        knowledgeMap: data.knowledgeMap || ""
      });
    });
    return filesList;
  } catch (error) {
    console.error("Error fetching uploaded files:", error);
    return [];
  }
}

export async function getFileKnowledgeMap(uid: string, fileId: string): Promise<string> {
  try {
    const fileRef = doc(db, "users", uid, "uploads", fileId);
    const snap = await getDoc(fileRef);
    if (snap.exists()) {
      return snap.data().knowledgeMap || "";
    }
  } catch (err) {
    console.error("Error getting file knowledge map:", err);
  }
  return "";
}

// 2. TOPICS (topicId inside the nested subcollection users/{uid}/uploads/{uploadId}/topics/{topicId} matching diagram hierarchy exactly)
export async function saveTopicToFirestore(
  uid: string,
  topic: Concept & { 
    uploadId?: string; 
    masteryScore?: number; 
    status?: string;
    latestExplanation?: string;
    latestFeedback?: string;
  }
): Promise<void> {
  try {
    const uploadId = topic.uploadId || "global";
    const topicId = topic.id;
    const topicRef = doc(db, "users", uid, "uploads", uploadId, "topics", topicId);
    
    // Determine mastery and status mapping
    const mastery = topic.masteryScore !== undefined ? topic.masteryScore : 0;
    let status = topic.status || "locked";
    
    if (mastery >= 85) {
      status = "mastered";
    } else if (mastery >= 60) {
      status = "learning";
    } else if (mastery > 0) {
      status = "weak";
    } else if (!topic.status) {
      status = "learning";
    }

    const payload: any = {
      title: topic.title || "",
      summary: topic.summary || "",
      difficulty: topic.difficulty || "Medium",
      mastery: mastery,
      status: status,
      updatedAt: new Date().toISOString()
    };

    if (topic.latestExplanation !== undefined) {
      payload.latestExplanation = topic.latestExplanation;
    }
    if (topic.latestFeedback !== undefined) {
      payload.latestFeedback = topic.latestFeedback;
    }

    await setDoc(topicRef, payload, { merge: true });
  } catch (error) {
    console.error("Error saving topic to nested collection:", error);
  }
}

export async function getTopicsFromFirestore(uid: string, uploadId?: string): Promise<Concept[]> {
  try {
    const finalUploadId = uploadId || "global";
    const topicsColl = collection(db, "users", uid, "uploads", finalUploadId, "topics");
    const snapshot = await getDocs(topicsColl);
    const topicsList: Concept[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      topicsList.push({
        id: docSnap.id,
        title: data.title || data.topicName || "",
        difficulty: data.difficulty || data.importance || "Medium",
        summary: data.summary || "",
        suggestedExplanationPrompt: data.suggestedExplanationPrompt || ""
      });
    });
    return topicsList;
  } catch (error) {
    console.error("Error fetching topics from nested collection:", error);
    return [];
  }
}

// 3. EXPLANATIONS (Save to the unified attempt document in subcollection users/{uid}/uploads/{uploadId}/topics/{topicId}/attempts/{attemptId})
export async function saveExplanationToFirestore(
  uid: string,
  explanationId: string,
  data: {
    conceptTitle: string;
    userExplanation: string;
    score: number;
    clarity: number;
    accuracy: number;
    simplicity: number;
    completeness: number;
    uploadId?: string;
    topicId?: string;
  }
): Promise<void> {
  try {
    const uploadId = data.uploadId || "global";
    const topicId = data.topicId || "global_topic";
    const attemptId = explanationId;
    
    const attemptRef = doc(db, "users", uid, "uploads", uploadId, "topics", topicId, "attempts", attemptId);
    await setDoc(attemptRef, {
      explanation: data.userExplanation || "",
      simplicity: data.simplicity !== undefined ? data.simplicity : 0,
      completeness: data.completeness !== undefined ? data.completeness : 0,
      accuracy: data.accuracy !== undefined ? data.accuracy : 0,
      grade: data.score !== undefined ? data.score : 0,
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Error saving explanation to attempts subcollection:", error);
  }
}

// 4. FEEDBACK (Save to the unified attempt document in subcollection users/{uid}/uploads/{uploadId}/topics/{topicId}/attempts/{attemptId})
export async function saveFeedbackToFirestore(
  uid: string,
  feedbackId: string,
  data: {
    explanationId: string;
    conceptTitle: string;
    suggestions: string;
    feedbackText: string;
    gaps: string[];
    uploadId?: string;
    topicId?: string;
  }
): Promise<void> {
  try {
    const uploadId = data.uploadId || "global";
    const topicId = data.topicId || "global_topic";
    const attemptId = data.explanationId;
    
    const attemptRef = doc(db, "users", uid, "uploads", uploadId, "topics", topicId, "attempts", attemptId);
    await setDoc(attemptRef, {
      followUpQuestion: data.feedbackText || "",
      gaps: data.gaps || [],
      reviewed: true,
      review: data.feedbackText || ""
    }, { merge: true });
  } catch (error) {
    console.error("Error saving feedback to attempts subcollection:", error);
  }
}

// 5. ACHIEVEMENTS (achievementId)
export async function saveAchievementToFirestore(
  uid: string,
  achievementId: string,
  data: {
    title: string;
    description: string;
    unlockedAt: string;
  }
): Promise<void> {
  try {
    const achRef = doc(db, "users", uid, "achievements", achievementId);
    await setDoc(achRef, data);
  } catch (error) {
    console.error("Error saving achievement:", error);
  }
}


