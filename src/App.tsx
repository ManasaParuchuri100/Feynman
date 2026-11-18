import React, { useState, useEffect, useRef } from "react";
import { UploadedFile } from "./types";
import Sidebar from "./components/Sidebar";
import MainDashboard from "./components/MainDashboard";
import FeynmanArena from "./components/FeynmanArena";
import { Upload } from "lucide-react";
import { 
  auth, 
  onAuthStateChanged, 
  getUploadedFilesFromFirestore, 
  saveUploadedFileToFirestore, 
  deleteUploadedFileFromFirestore 
} from "./lib/firebase";

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [activeFile, setActiveFile] = useState<UploadedFile | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const globalFileInputRef = useRef<HTMLInputElement>(null);

  // Load and sync uploaded files from Firestore when user is logged in, or fallback to localStorage
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setActiveFile(null); // Reset active file view when changing users/accounts to prevent state bleeding
      
      if (user) {
        getUploadedFilesFromFirestore(user.uid).then((cloudFiles) => {
          // Retrieve what we currently have in local state / local storage for this specific user
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

          // Combine cloud files with any user-specific local files not yet in cloud files
          const cloudIds = new Set(cloudFiles.map(f => f.id));
          const uniqueLocal = localFiles.filter(f => !cloudIds.has(f.id));
          const combined = [...cloudFiles, ...uniqueLocal];

          setFiles(combined);
          if (combined.length > 0) {
            // Save local unique ones back to firestore for persistent syncing
            uniqueLocal.forEach((f) => {
              saveUploadedFileToFirestore(user.uid, f.id, f.name, f.content, f.knowledgeMap || "", []);
            });
            localStorage.setItem(userKey, JSON.stringify(combined));
          } else {
            localStorage.setItem(userKey, JSON.stringify([]));
          }
        });
      } else {
        // Retrieve guest files from isolated guest storage key
        const guestKey = "feynman_uploaded_files_guest";
        let cached = localStorage.getItem(guestKey);
        if (!cached) {
          // Fallback to legacy key to migrate existing users once
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
  const saveFiles = (updatedFiles: UploadedFile[]) => {
    setFiles(updatedFiles);
    const key = auth.currentUser ? `feynman_uploaded_files_${auth.currentUser.uid}` : "feynman_uploaded_files_guest";
    localStorage.setItem(key, JSON.stringify(updatedFiles));
    
    if (auth.currentUser) {
      updatedFiles.forEach((f) => {
        saveUploadedFileToFirestore(auth.currentUser!.uid, f.id, f.name, f.content, f.knowledgeMap || "", []);
      });
    }
  };

  // Convert File object to local app structures
  const processUploadedFiles = async (fileList: FileList) => {
    setIsUploading(true);
    const newProcessedFiles: UploadedFile[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const originalFile = fileList[i];
      
      try {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          
          reader.onload = () => {
            resolve(reader.result as string);
          };
          
          reader.onerror = () => {
            reject(new Error("File reading failed"));
          };

          if (originalFile.type.startsWith("image/") || originalFile.type === "application/pdf" || originalFile.name.endsWith(".pdf")) {
            reader.readAsDataURL(originalFile);
          } else {
            // Read standard text-like documents
            reader.readAsText(originalFile);
          }
        });

        let fileType = originalFile.type || "text/plain";
        if (originalFile.name.toLowerCase().endsWith(".pdf")) {
          fileType = "application/pdf";
        }

        const newFile: UploadedFile = {
          id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
          name: originalFile.name,
          size: originalFile.size,
          type: fileType,
          content: content,
          uploadedAt: new Date().toISOString(),
        };

        newProcessedFiles.push(newFile);
      } catch (err) {
        console.error(`Error reading file ${originalFile.name}:`, err);
        
        // Handle fallback text creation for complex or unsupported binaries so app doesn't crash
        const fallbackText = `Document Name: ${originalFile.name}\nSize: ${originalFile.size} bytes\nFormat: ${originalFile.type}\nUnreadable binary data. Topic summary of Feynman Technique study material.`;
        const fallbackFile: UploadedFile = {
          id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
          name: originalFile.name,
          size: originalFile.size,
          type: originalFile.type || "text/plain",
          content: fallbackText,
          uploadedAt: new Date().toISOString(),
        };
        newProcessedFiles.push(fallbackFile);
      }
    }

    if (newProcessedFiles.length > 0) {
      const totalFilesList = [...newProcessedFiles, ...files];
      saveFiles(totalFilesList);
      
      // Auto-focus on the first newly uploaded file
      setActiveFile(newProcessedFiles[0]);
    }
    setIsUploading(false);
  };

  const handleTextPasted = (title: string, text: string) => {
    setIsUploading(true);
    const newFile: UploadedFile = {
      id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      name: title.trim() || "Pasted Notes",
      size: text.length,
      type: "text/plain",
      content: text,
      uploadedAt: new Date().toISOString(),
    };
    const totalFilesList = [newFile, ...files];
    saveFiles(totalFilesList);
    setActiveFile(newFile);
    setIsUploading(false);
  };

  const handleDeleteFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering file selection
    const confirmed = true; // Delete immediately for responsive slick UX
    if (confirmed) {
      const filtered = files.filter((f) => f.id !== id);
      saveFiles(filtered);
      
      if (auth.currentUser) {
        deleteUploadedFileFromFirestore(auth.currentUser.uid, id);
      }
      
      if (activeFile && activeFile.id === id) {
        setActiveFile(null);
      }
    }
  };

  const handleGlobalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFiles(e.target.files);
    }
  };

  const triggerGlobalUpload = () => {
    globalFileInputRef.current?.click();
  };

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#03030f] text-slate-100 font-sans" id="app-root-viewport">
      
      {/* Hidden global input for file uploading */}
      <input
        type="file"
        id="global-file-selector"
        ref={globalFileInputRef}
        onChange={handleGlobalFileChange}
        multiple
        className="hidden"
        accept=".txt,.md,.mdx,.json,.csv,.png,.jpg,.jpeg,.pdf"
      />

      {/* Floating loading overlay for process processing */}
      {isUploading && (
        <div className="fixed inset-0 bg-[#020207]/80 backdrop-blur-md z-55 flex flex-col items-center justify-center space-y-4" id="uploading-spinner">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <h3 className="text-sm font-semibold text-purple-200">Processing Document</h3>
          <p className="text-xs text-slate-500">Reading contents and establishing secure sandbox...</p>
        </div>
      )}

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
