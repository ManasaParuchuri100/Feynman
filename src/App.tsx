import React, { useState, useEffect, useRef } from "react";
import { UploadedFile } from "./types";
import Sidebar from "./components/Sidebar";
import MainDashboard from "./components/MainDashboard";
import FeynmanArena from "./components/FeynmanArena";
import { 
  auth, 
  onAuthStateChanged, 
  getUploadedFilesFromFirestore, 
  saveUploadedFileToFirestore, 
  deleteUploadedFileFromFirestore,
  saveTopicToFirestore,
  saveAchievementToFirestore
} from "./lib/firebase";
import { authFetch, safeSaveFilesToLocalStorage } from "./lib/api";

const SMALL_INLINE_LIMIT_BYTES = 350_000;

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [activeFile, setActiveFile] = useState<UploadedFile | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const globalFileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<UploadedFile[]>(files);
  filesRef.current = files;

  const getStorageKey = () =>
    auth.currentUser
      ? `feynman_uploaded_files_${auth.currentUser.uid}`
      : "feynman_uploaded_files_guest";

  // Load and sync uploaded files from Firestore when user is logged in, or fallback to localStorage
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setActiveFile(null); // Reset active file view when changing users/accounts to prevent state bleeding
      
      if (user) {
        getUploadedFilesFromFirestore(user.uid).then((cloudFiles) => {
          const userKey = `feynman_uploaded_files_${user.uid}`;
          const cached = localStorage.getItem(userKey);
          let localFiles: UploadedFile[] = [];
          if (cached) {
            try {
              localFiles = JSON.parse(cached) as UploadedFile[];
            } catch (e) {
              console.error("Failed to parse cached files on auth change", e);
            }
          }

          const cloudIds = new Set(cloudFiles.map(f => f.id));
          const uniqueLocal = localFiles.filter(f => !cloudIds.has(f.id));
          const combined = [...cloudFiles, ...uniqueLocal];

          setFiles(combined);
          if (combined.length > 0) {
            uniqueLocal.forEach((f) => {
              saveUploadedFileToFirestore(user.uid, f.id, f.name, f.content, f.knowledgeMap || "", [], {
                contentHash: f.contentHash,
                ragStatus: f.ragStage,
                pageCount: f.pageCount,
                chunkCount: f.chunkCount,
                documentOverview: f.documentOverview,
              });
            });
            safeSaveFilesToLocalStorage(userKey, combined);
          } else {
            safeSaveFilesToLocalStorage(userKey, []);
          }
        });
      } else {
        const guestKey = "feynman_uploaded_files_guest";
        let cached = localStorage.getItem(guestKey);
        if (!cached) {
          cached = localStorage.getItem("feynman_uploaded_files") || localStorage.getItem("feymann_uploaded_files");
          if (cached) {
            localStorage.setItem(guestKey, cached);
          }
        }
        
        if (cached) {
          try {
            const parsedFiles = JSON.parse(cached);
            setFiles(parsedFiles);
          } catch (e) {
            console.error("Failed to restore cached files", e);
          }
        } else {
          setFiles([]);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Save files to localStorage & Firestore whenever list changes
  const saveFiles = (updatedFiles: UploadedFile[], syncFirestore = true) => {
    setFiles(updatedFiles);
    const key = getStorageKey();
    safeSaveFilesToLocalStorage(key, updatedFiles);
    
    if (syncFirestore && auth.currentUser) {
      updatedFiles.forEach((f) => {
        saveUploadedFileToFirestore(auth.currentUser!.uid, f.id, f.name, f.content, f.knowledgeMap || "", [], {
          contentHash: f.contentHash,
          ragStatus: f.ragStage,
          pageCount: f.pageCount,
          chunkCount: f.chunkCount,
          documentOverview: f.documentOverview,
        });
      });
    }
  };

  const updateFileMetadata = (fileId: string, patch: Partial<UploadedFile>) => {
    setFiles((prev) => {
      const next = prev.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
      safeSaveFilesToLocalStorage(getStorageKey(), next);
      return next;
    });
    setActiveFile((prev) => (prev && prev.id === fileId ? { ...prev, ...patch } : prev));
  };

  // Non-blocking background polling for documents actively undergoing RAG ingestion
  useEffect(() => {
    const activeStages = new Set(["queued", "extracting", "chunking", "embedding", "indexing", "summarizing"]);
    const inFlight = files.filter((f) => f.ragStage && activeStages.has(f.ragStage));
    if (inFlight.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      for (const item of inFlight) {
        if (cancelled) return;
        try {
          const res = await authFetch(`/api/rag/status/${encodeURIComponent(item.id)}`);
          if (!res.ok) continue;
          const record = await res.json();
          if (cancelled) return;

          const patch: Partial<UploadedFile> = {
            ragStage: record.stage,
            ragProgress: record.progress,
            ragMessage: record.message,
            ragError: record.error,
            pageCount: record.pageCount,
            chunkCount: record.chunkCount,
            contentHash: record.contentHash,
          };

          if (record.stage === "ready" && record.structure) {
            const conceptsList = record.structure.concepts || [];
            patch.knowledgeMap = JSON.stringify(conceptsList);
            patch.documentOverview = record.structure.overview;
            patch.chapters = record.structure.chapters;
            patch.keyDefinitions = record.structure.keyDefinitions;

            if (auth.currentUser) {
              const uid = auth.currentUser.uid;
              saveUploadedFileToFirestore(
                uid,
                item.id,
                item.name,
                item.content,
                patch.knowledgeMap,
                conceptsList,
                {
                  contentHash: record.contentHash,
                  ragStatus: "ready",
                  pageCount: record.pageCount,
                  chunkCount: record.chunkCount,
                  documentOverview: record.structure.overview,
                }
              );
              conceptsList.forEach((concept: any) => {
                saveTopicToFirestore(uid, {
                  ...concept,
                  uploadId: item.id,
                  masteryScore: 0,
                });
              });
              saveAchievementToFirestore(uid, "ach_first_upload", {
                title: "First Document Uploaded",
                description: `Uploaded and indexed your study material: "${item.name}".`,
                unlockedAt: new Date().toISOString(),
              });
            }
          }

          updateFileMetadata(item.id, patch);
        } catch {
          // transient poll errors will retry on next tick
        }
      }
    };

    const interval = setInterval(poll, 700);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [files]);

  // Convert File object to local app structures & trigger asynchronous background RAG ingestion
  const processUploadedFiles = async (fileList: FileList) => {
    const newProcessedFiles: UploadedFile[] = [];
    const ingestionTriggers: Array<{ fileId: string; originalFile: File; inlineContent?: string; fileType: string }> = [];

    for (let i = 0; i < fileList.length; i++) {
      const originalFile = fileList[i];
      const fileId = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      let fileType = originalFile.type || "text/plain";
      const lowerName = originalFile.name.toLowerCase();
      if (lowerName.endsWith(".pdf")) {
        fileType = "application/pdf";
      } else if (lowerName.endsWith(".pptx")) {
        fileType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else if (lowerName.endsWith(".ppt")) {
        fileType = "application/vnd.ms-powerpoint";
      }

      const isPowerPoint =
        fileType.includes("presentation") ||
        fileType.includes("powerpoint") ||
        lowerName.endsWith(".ppt") ||
        lowerName.endsWith(".pptx");

      const isBinaryOrPdf =
        fileType.startsWith("image/") ||
        fileType === "application/pdf" ||
        lowerName.endsWith(".pdf") ||
        isPowerPoint;

      let content = `/api/rag/document/${encodeURIComponent(fileId)}/file`;

      // Read small files inline for instant preview/text access; stream larger binaries and PowerPoint decks directly via FormData
      if (!isBinaryOrPdf && originalFile.size <= SMALL_INLINE_LIMIT_BYTES) {
        try {
          content = await originalFile.text();
        } catch {
          content = `/api/rag/document/${encodeURIComponent(fileId)}/file`;
        }
      } else if (isBinaryOrPdf && !isPowerPoint && originalFile.size <= SMALL_INLINE_LIMIT_BYTES) {
        try {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("File reading failed"));
            reader.readAsDataURL(originalFile);
          });
        } catch {
          content = `/api/rag/document/${encodeURIComponent(fileId)}/file`;
        }
      }

      const newFile: UploadedFile = {
        id: fileId,
        name: originalFile.name,
        size: originalFile.size,
        type: fileType,
        content,
        uploadedAt: new Date().toISOString(),
        ragStage: "extracting",
        ragProgress: 8,
        ragMessage: "Starting background RAG indexing...",
      };

      newProcessedFiles.push(newFile);
      ingestionTriggers.push({
        fileId,
        originalFile,
        inlineContent: content.startsWith("/api/") ? undefined : content,
        fileType,
      });
    }

    if (newProcessedFiles.length > 0) {
      const totalFilesList = [...newProcessedFiles, ...filesRef.current];
      saveFiles(totalFilesList);
      setActiveFile(newProcessedFiles[0]);

      // Launch background ingestion asynchronously without blocking UI navigation
      ingestionTriggers.forEach(async (item) => {
        try {
          const formData = new FormData();
          formData.append("fileId", item.fileId);
          formData.append("fileName", item.originalFile.name);
          formData.append("fileType", item.fileType);
          formData.append("fileSize", String(item.originalFile.size));
          formData.append("file", item.originalFile);

          const res = await authFetch("/api/rag/ingest", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `Ingestion failed (${res.status})`);
          }
          const data = await res.json();
          const patch: Partial<UploadedFile> = {
            ragStage: data.stage,
            ragProgress: data.progress,
            ragMessage: data.message,
            ragError: data.error,
            pageCount: data.pageCount,
            chunkCount: data.chunkCount,
            contentHash: data.contentHash,
          };
          if (data.stage === "ready" && data.structure) {
            patch.knowledgeMap = JSON.stringify(data.structure.concepts || []);
            patch.documentOverview = data.structure.overview;
            patch.chapters = data.structure.chapters;
            patch.keyDefinitions = data.structure.keyDefinitions;
          }
          updateFileMetadata(item.fileId, patch);
        } catch (err: any) {
          updateFileMetadata(item.fileId, {
            ragStage: "error",
            ragProgress: 100,
            ragError: err?.message || "Failed to ingest document",
            ragMessage: err?.message || "Failed to ingest document",
          });
        }
      });
    }
  };

  const handleTextPasted = (title: string, text: string) => {
    const fileId = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const fileName = title.trim() || "Pasted Notes";
    const newFile: UploadedFile = {
      id: fileId,
      name: fileName,
      size: text.length,
      type: "text/plain",
      content: text.length > SMALL_INLINE_LIMIT_BYTES ? `/api/rag/document/${encodeURIComponent(fileId)}/file` : text,
      uploadedAt: new Date().toISOString(),
      ragStage: "extracting",
      ragProgress: 10,
      ragMessage: "Starting background RAG indexing...",
    };
    const totalFilesList = [newFile, ...filesRef.current];
    saveFiles(totalFilesList);
    setActiveFile(newFile);

    // Trigger background ingestion asynchronously
    authFetch("/api/rag/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId,
        fileName,
        fileType: "text/plain",
        fileSize: text.length,
        fileContent: text,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Ingestion failed (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        const patch: Partial<UploadedFile> = {
          ragStage: data.stage,
          ragProgress: data.progress,
          ragMessage: data.message,
          ragError: data.error,
          pageCount: data.pageCount,
          chunkCount: data.chunkCount,
          contentHash: data.contentHash,
        };
        if (data.stage === "ready" && data.structure) {
          patch.knowledgeMap = JSON.stringify(data.structure.concepts || []);
          patch.documentOverview = data.structure.overview;
          patch.chapters = data.structure.chapters;
          patch.keyDefinitions = data.structure.keyDefinitions;
        }
        updateFileMetadata(fileId, patch);
      })
      .catch((err: any) => {
        updateFileMetadata(fileId, {
          ragStage: "error",
          ragProgress: 100,
          ragError: err?.message || "Failed to index notes",
          ragMessage: err?.message || "Failed to index notes",
        });
      });
  };

  const handleDeleteFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering file selection
    const filtered = files.filter((f) => f.id !== id);
    saveFiles(filtered, false);

    if (auth.currentUser) {
      deleteUploadedFileFromFirestore(auth.currentUser.uid, id);
    }

    // Delete vectors and stored binary on server for this user only
    authFetch(`/api/rag/document/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});

    if (activeFile && activeFile.id === id) {
      setActiveFile(null);
    }
  };

  const handleGlobalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFiles(e.target.files);
      e.target.value = "";
    }
  };

  const triggerGlobalUpload = () => {
    globalFileInputRef.current?.click();
  };

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#FAFAFC] dark:bg-[#070711] text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200" id="app-root-viewport">
      
      {/* Hidden global input for file uploading */}
      <input
        type="file"
        id="global-file-selector"
        ref={globalFileInputRef}
        onChange={handleGlobalFileChange}
        multiple
        className="hidden"
        accept=".txt,.md,.mdx,.json,.csv,.png,.jpg,.jpeg,.pdf,.ppt,.pptx"
      />

      {/* Collapsible Sidebar */}
      <Sidebar
        files={files}
        activeFileId={activeFile?.id || null}
        onSelectFile={(file) => setActiveFile(file)}
        onDeleteFile={handleDeleteFile}
        onUploadClick={triggerGlobalUpload}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      {/* Primary Workspace Panel */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative" id="app-workspace-body">
        {activeFile ? (
          <FeynmanArena
            file={activeFile}
            allFiles={files}
            onBack={() => setActiveFile(null)}
            onUpdateFileMeta={updateFileMetadata}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={toggleSidebarCollapse}
          />
        ) : (
          <MainDashboard
            onFilesUploaded={processUploadedFiles}
            onTextPasted={handleTextPasted}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={toggleSidebarCollapse}
          />
        )}
      </div>
    </div>
  );
}
