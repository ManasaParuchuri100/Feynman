import React, { useRef, useState, useEffect } from "react";
import { Upload, FileText, Mail, Lock, User, PanelLeftOpen, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import ThemeToggle from "./ThemeToggle";
import {
  auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signInWithPopup,
  googleProvider,
  signOut,
  onAuthStateChanged,
  FirebaseUser,
  getUserProfile,
  syncUserProfile
} from "../lib/firebase";
import { UserProfile } from "../types";

interface MainDashboardProps {
  onFilesUploaded: (uploadedFiles: FileList) => void;
  onTextPasted: (title: string, text: string) => void;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export default function MainDashboard({
  onFilesUploaded,
  onTextPasted,
  isSidebarCollapsed,
  onToggleSidebar,
}: MainDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [showStartModal, setShowStartModal] = useState(false);
  const [authStage, setAuthStage] = useState<"idle" | "loading" | "success">("idle");
  const [authType, setAuthType] = useState("");
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [authError, setAuthError] = useState("");

  // Set up Firebase auth state observer and load Firestore user profile
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsLoadingProfile(true);
        getUserProfile(currentUser.uid).then((prof) => {
          if (prof) {
            setUserProfile(prof);
          } else {
            syncUserProfile(currentUser.uid, currentUser.email || "", currentUser.displayName || "").then((newProf) => {
              setUserProfile(newProf);
            });
          }
          setIsLoadingProfile(false);
        }).catch(err => {
          console.error("Failed to fetch user profile", err);
          setIsLoadingProfile(false);
        });
      } else {
        setUserProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setForgotPasswordSent(false);

    if (isSignUp) {
      if (password !== confirmPassword) {
        setAuthError("Passwords do not match");
        return;
      }
      setAuthType("Sign Up");
      setAuthStage("loading");
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (fullName.trim()) {
          await updateProfile(userCredential.user, {
            displayName: fullName.trim()
          });
        }
        const syncedProf = await syncUserProfile(
          userCredential.user.uid,
          userCredential.user.email || email,
          fullName.trim() || userCredential.user.displayName || "",
          userCredential.user.photoURL || ""
        );
        setUserProfile(syncedProf);
        setAuthStage("success");
        setTimeout(() => {
          setShowStartModal(false);
          setFullName("");
          setEmail("");
          setPassword("");
          setConfirmPassword("");
        }, 1200);
      } catch (err: any) {
        setAuthStage("idle");
        let msg = err.message || "An error occurred during account creation.";
        if (err.code === "auth/email-already-in-use") {
          msg = "Email address is already registered.";
        } else if (err.code === "auth/weak-password") {
          msg = "Password must be at least 6 characters.";
        } else if (err.code === "auth/invalid-email") {
          msg = "Invalid email format.";
        }
        setAuthError(msg);
      }
    } else {
      setAuthType("Login");
      setAuthStage("loading");
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const syncedProf = await syncUserProfile(
          userCredential.user.uid,
          userCredential.user.email || email,
          userCredential.user.displayName || "",
          userCredential.user.photoURL || ""
        );
        setUserProfile(syncedProf);
        setAuthStage("success");
        setTimeout(() => {
          setShowStartModal(false);
          setEmail("");
          setPassword("");
        }, 1200);
      } catch (err: any) {
        setAuthStage("idle");
        let msg = err.message || "An error occurred during authentication.";
        if (
          err.code === "auth/invalid-credential" || 
          err.code === "auth/wrong-password" || 
          err.code === "auth/user-not-found"
        ) {
          msg = "Invalid email or password.";
        } else if (err.code === "auth/invalid-email") {
          msg = "Invalid email format.";
        }
        setAuthError(msg);
      }
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError("");
    setAuthType("Google Sync");
    setAuthStage("loading");
    try {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const syncedProf = await syncUserProfile(
        userCredential.user.uid,
        userCredential.user.email || "",
        userCredential.user.displayName || "",
        userCredential.user.photoURL || ""
      );
      setUserProfile(syncedProf);
      setAuthStage("success");
      setTimeout(() => {
        setShowStartModal(false);
      }, 1200);
    } catch (err: any) {
      setAuthStage("idle");
      let msg = err.message || "Google authentication was cancelled or failed.";
      if (err.code === "auth/popup-blocked") {
        msg = "Authentication popup was blocked by browser. Please enable popups.";
      }
      setAuthError(msg);
    }
  };

  const handleForgotPassword = async () => {
    setAuthError("");
    if (!email) {
      setAuthError("Please enter your email first in the input field above, then click Forgot Password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setForgotPasswordSent(true);
    } catch (err: any) {
      setForgotPasswordSent(false);
      let msg = err.message || "Could not send password reset email.";
      if (err.code === "auth/user-not-found") {
        msg = "No user found with this email address.";
      } else if (err.code === "auth/invalid-email") {
        msg = "Invalid email format.";
      }
      setAuthError(msg);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      console.error("Logout failed:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesUploaded(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesUploaded(e.target.files);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      id="main-dashboard-container"
      className="relative flex-1 h-screen flex flex-col items-center justify-between px-6 py-5 overflow-y-auto bg-[#FAFAFC] dark:bg-[#070711] text-slate-900 dark:text-slate-100 transition-colors duration-200"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Subtle Architectural Backdrop Gradient */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" id="bg-decoration">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full bg-gradient-to-b from-violet-200/45 via-fuchsia-100/20 to-transparent dark:from-violet-900/20 dark:via-fuchsia-900/10 dark:to-transparent blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.14]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(100,116,139,0.22) 1px, transparent 0)",
            backgroundSize: "28px 28px"
          }}
        />
      </div>

      {/* Header Panel */}
      <header className="w-full relative z-10 flex items-center justify-between gap-4 py-1" id="dashboard-header">
        <div id="sidebar-toggle-trigger" className="flex items-center">
          {isSidebarCollapsed && (
            <button
              id="btn-reopen-sidebar"
              onClick={onToggleSidebar}
              className="inline-flex items-center gap-2 py-2 px-3 rounded-lg bg-white dark:bg-white/[0.04] border border-slate-200/90 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/15 transition-all text-xs font-medium cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
            >
              <PanelLeftOpen className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span>Study Library</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0" id="header-auth-links">
          <ThemeToggle />

          {user ? (
            <div className="flex items-center gap-3 bg-white dark:bg-white/[0.04] border border-slate-200/90 dark:border-white/[0.08] px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 shadow-2xs">
              <span className="truncate max-w-[150px]">{user.displayName || user.email}</span>
              <button
                onClick={handleLogout}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white pl-2.5 border-l border-slate-200 dark:border-white/10 transition-colors cursor-pointer focus-visible:outline-none whitespace-nowrap"
                id="btn-header-logout"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              id="btn-get-started"
              onClick={() => {
                setShowStartModal(true);
                setAuthStage("idle");
                setAuthType("");
                setAuthError("");
                setForgotPasswordSent(false);
              }}
              className="px-4 py-2 rounded-lg text-xs font-semibold tracking-wide bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 whitespace-nowrap shrink-0 shadow-xs"
            >
              Get started
            </button>
          )}
        </div>
      </header>

      {/* Central Content Column */}
      <main className="relative z-10 flex flex-col items-center justify-center my-auto w-full max-w-2xl px-4 py-8 text-center" id="dashboard-central">
        
        {/* Brand Wordmark */}
        <motion.h1
          id="feynman-logo"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="text-5xl sm:text-6xl md:text-[76px] font-extrabold tracking-[0.22em] text-slate-950 dark:text-white pl-[0.22em] select-none"
        >
          FEYNMAN
        </motion.h1>

        {/* Scholarly Serif Tagline */}
        <motion.p
          id="feynman-slogan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.12 }}
          className="text-slate-500 dark:text-slate-400 text-lg md:text-2xl font-normal italic tracking-wide mt-3"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          teach it to learn it
        </motion.p>

        {/* Segmented Control between Upload and Paste */}
        <motion.div
          id="dashboard-input-tabs"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18 }}
          className="inline-flex items-center bg-slate-200/75 dark:bg-white/[0.05] p-1 rounded-xl border border-slate-200/90 dark:border-white/[0.08] mt-8 relative z-10"
        >
          <button
            id="tab-btn-upload"
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === "upload"
                ? "bg-white dark:bg-[#17172b] text-slate-900 dark:text-white shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
            onClick={() => setActiveTab("upload")}
          >
            <Upload className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            <span>Upload File</span>
          </button>
          <button
            id="tab-btn-paste"
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === "paste"
                ? "bg-white dark:bg-[#17172b] text-slate-900 dark:text-white shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
            onClick={() => setActiveTab("paste")}
          >
            <FileText className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            <span>Paste Text / Notes</span>
          </button>
        </motion.div>

        {activeTab === "upload" ? (
          /* Clean Single-Elevation Upload Dropzone Card */
          <motion.div
            id="upload-widget"
            key="upload-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={triggerFileInput}
            className={`w-full max-w-lg mt-6 rounded-2xl border bg-white dark:bg-[#0E0E1D] p-9 md:p-11 transition-all duration-200 relative group cursor-pointer ${
              isDragging 
                ? "border-violet-500 bg-violet-50/70 dark:bg-violet-950/20 scale-[1.01] shadow-lg" 
                : "border-slate-200/90 dark:border-white/[0.08] hover:border-violet-300 dark:hover:border-violet-500/40 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.04)] dark:shadow-none hover:-translate-y-0.5"
            }`}
          >
            <input
              type="file"
              id="file-uploader"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
              accept=".txt,.md,.mdx,.json,.csv,.png,.jpg,.jpeg,.pdf,.ppt,.pptx"
            />

            <div className="flex flex-col items-center justify-center relative z-10 space-y-4" id="upload-widget-content">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200/80 dark:border-violet-500/20 flex items-center justify-center text-violet-600 dark:text-violet-400 group-hover:scale-105 transition-transform">
                <Upload className="w-5 h-5" id="icon-inner-upload" />
              </div>

              <div className="space-y-1.5">
                <p className="text-slate-900 dark:text-slate-100 text-sm font-semibold" id="upload-badge-label">
                  Drop your study material here or browse
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-xs">
                  PDF, PowerPoint (PPT / PPTX), Markdown, Text, CSV, or Lecture Slide Images
                </p>
              </div>

              <span
                id="upload-badge-button"
                className="mt-1 py-2 px-5 rounded-xl bg-violet-600 group-hover:bg-violet-700 dark:bg-violet-600 dark:group-hover:bg-violet-500 text-white transition-all text-xs font-semibold inline-flex items-center gap-2 shadow-xs pointer-events-none"
              >
                <span>Choose File</span>
              </span>
            </div>
          </motion.div>
        ) : (
          /* Clean Single-Elevation Paste Plain Text Card */
          <motion.div
            id="paste-widget"
            key="paste-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg mt-6 rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0E0E1D] p-6 md:p-7 text-left relative shadow-[0_1px_3px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.04)] dark:shadow-none"
          >
            <div className="space-y-4 relative z-10" id="paste-form-container">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Topic or Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Support Vector Machines, Photoelectric Effect..."
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/[0.08] rounded-xl text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-500 dark:focus:border-violet-400 transition-all font-medium"
                  id="paste-title-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Study Notes or Excerpt
                </label>
                <textarea
                  placeholder="Paste your lecture notes, transcript, or chapter summary here..."
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  className="w-full h-32 px-3.5 py-2.5 bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/[0.08] rounded-xl text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-500 dark:focus:border-violet-400 resize-none leading-relaxed"
                  id="paste-text-textarea"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  id="btn-submit-pasted-text"
                  disabled={!pastedText.trim()}
                  onClick={() => {
                    const finalTitle = pastedTitle.trim() || `Pasted Text (${new Date().toLocaleDateString()})`;
                    onTextPasted(finalTitle, pastedText);
                  }}
                  className={`px-5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 inline-flex items-center gap-2 cursor-pointer ${
                    pastedText.trim()
                      ? "bg-violet-600 hover:bg-violet-700 text-white shadow-xs active:scale-[0.98]"
                      : "bg-slate-100 dark:bg-white/[0.05] text-slate-400 dark:text-slate-500 cursor-not-allowed"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start Studying</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </main>

      {/* Subtle Bottom Spacer for Visual Balance */}
      <div className="h-4 shrink-0" />

      {/* Get Started Auth Modal */}
      {showStartModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/75 backdrop-blur-sm p-4"
          onClick={() => setShowStartModal(false)}
          id="get-started-modal"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[390px] rounded-2xl bg-white dark:bg-[#111122] border border-slate-200/90 dark:border-white/10 p-7 md:p-8 shadow-2xl relative text-left"
            id="get-started-card"
          >
            <button
              onClick={() => setShowStartModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer text-base p-1 focus:outline-none"
              title="Close modal"
              id="get-started-close-btn"
            >
              ✕
            </button>

            {authStage === "idle" ? (
              <div className="py-1">
                <div className="mb-6 select-none">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight" id="get-started-title">
                    {isSignUp ? "Create your workspace" : "Welcome back"}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Sync your uploaded notes and mastery progress across devices.
                  </p>
                </div>

                {authError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 rounded-xl text-rose-700 dark:text-rose-300 text-xs font-medium mb-4 leading-normal break-words" id="auth-error-banner">
                    {authError}
                  </div>
                )}

                <form 
                  onSubmit={handleAuthSubmit}
                  className="space-y-3.5"
                  id="get-started-form"
                >
                  {isSignUp && (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <User className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        required
                        type="text"
                        placeholder="Full Name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#090915] text-slate-900 dark:text-white placeholder-slate-400 font-medium text-sm py-3 pl-11 pr-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 border border-slate-200 dark:border-white/10 transition-all"
                        id="started-fullname-input"
                      />
                    </div>
                  )}

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      required
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#090915] text-slate-900 dark:text-white placeholder-slate-400 font-medium text-sm py-3 pl-11 pr-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 border border-slate-200 dark:border-white/10 transition-all"
                      id="started-email-input"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      required
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#090915] text-slate-900 dark:text-white placeholder-slate-400 font-medium text-sm py-3 pl-11 pr-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 border border-slate-200 dark:border-white/10 transition-all"
                      id="started-password-input"
                    />
                  </div>

                  {isSignUp && (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Lock className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        required
                        type="password"
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#090915] text-slate-900 dark:text-white placeholder-slate-400 font-medium text-sm py-3 pl-11 pr-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 border border-slate-200 dark:border-white/10 transition-all"
                        id="started-confirmpassword-input"
                      />
                    </div>
                  )}

                  {!isSignUp && (
                    <div className="flex items-center justify-between px-1">
                      {forgotPasswordSent ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Reset email sent</span>
                      ) : (
                        <div />
                      )}
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-xs text-violet-600 dark:text-violet-400 hover:underline font-medium cursor-pointer focus:outline-none"
                        id="btn-forgot-password"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-violet-600 hover:bg-violet-700 active:scale-[0.99] transition-all text-white font-semibold py-3 rounded-xl shadow-sm cursor-pointer focus:outline-none text-sm mt-2 block text-center"
                    id="get-started-primary-btn"
                  >
                    {isSignUp ? "Create Account" : "Continue Learning"}
                  </button>
                </form>

                <div className="relative flex py-4 items-center select-none" id="auth-divider">
                  <div className="flex-grow border-t border-slate-200 dark:border-white/10"></div>
                  <span className="flex-shrink mx-3 text-slate-400 text-xs">or</span>
                  <div className="flex-grow border-t border-slate-200 dark:border-white/10"></div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  className="w-full bg-white dark:bg-[#19192e] border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-[#20203a] active:scale-[0.99] transition-all text-slate-700 dark:text-slate-100 font-semibold py-3 rounded-xl cursor-pointer focus:outline-none text-sm flex items-center justify-center"
                  id="get-started-google-btn"
                >
                  <svg className="w-4 h-4 mr-2.5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <div className="text-center mt-5">
                  <button
                    onClick={() => setIsSignUp(!isSignUp)}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors font-medium cursor-pointer focus:outline-none"
                    id="get-started-toggle-btn"
                  >
                    {isSignUp ? (
                      <>
                        Already have an account? <span className="text-violet-600 dark:text-violet-400 font-semibold">Login</span>
                      </>
                    ) : (
                      <>
                        Don&apos;t have an account? <span className="text-violet-600 dark:text-violet-400 font-semibold">Sign Up</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : authStage === "loading" ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <div className="w-8 h-8 border-2 border-violet-600 dark:border-violet-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Establishing secure {authType === "Google Sync" ? "Google" : authType} session...
                </p>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <div className="w-10 h-10 rounded-full border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold">
                  ✓
                </div>
                <p className="text-sm text-slate-900 dark:text-white font-semibold">Welcome to Feynman</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Session ready</p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
