import React, { useRef, useState, useEffect } from "react";
import { Upload, Key, FileText, BookOpen, Mail, Lock, User } from "lucide-react";
import { motion } from "motion/react";
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
        // Extrude human-friendly error messages
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
      className="relative flex-1 h-screen flex flex-col items-center justify-between p-6 overflow-hidden bg-[#03030f]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Decorative Wave Background */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-15 overflow-hidden" id="bg-decoration">
        <svg
          className="absolute top-1/4 left-0 w-full h-[600px] text-purple-700/60"
          viewBox="0 0 1440 600"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,192 C240,112 480,112 720,192 C960,272 1200,272 1440,192 L1440,600 L0,600 Z"
            fill="url(#gradient-wave-1)"
          />
          <path
            d="M0,320 C360,224 720,416 1080,320 C1260,272 1350,272 1440,320 L1440,600 L0,600 Z"
            fill="url(#gradient-wave-2)"
            opacity="0.5"
          />
          <defs>
            <linearGradient id="gradient-wave-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#d946ef" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#3b0764" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="gradient-wave-2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#03001e" stopOpacity="0.0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Floating Sparkles and Orbs */}
      <div className="absolute top-[10%] left-[15%] w-72 h-72 rounded-full bg-purple-900/10 blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[10%] right-[15%] w-96 h-96 rounded-full bg-indigo-900/10 blur-[150px] pointer-events-none z-0" />

      {/* Header Panel */}
      <div className="w-full relative z-10 flex items-center justify-between py-1" id="dashboard-header">
        <div id="sidebar-toggle-trigger">
          {isSidebarCollapsed && (
            <button
              id="btn-reopen-sidebar"
              onClick={onToggleSidebar}
              className="flex items-center space-x-2 py-1.5 px-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all text-xs cursor-pointer shadow-sm hover:shadow-purple-500/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>Recent Uploads</span>
            </button>
          )}
        </div>

        <div className="flex items-center space-x-6" id="header-auth-links">
          {user ? (
            <div className="flex items-center space-x-3 bg-slate-900/40 border border-slate-800/60 px-3 py-1.5 rounded-lg text-xs font-mono font-medium text-slate-300">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="truncate max-w-[150px]">{user.displayName || user.email}</span>
              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-white hover:underline pl-2 border-l border-slate-800/80 transition-colors cursor-pointer focus:outline-none"
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
              className="px-4 py-1.5 rounded-lg text-[13px] font-medium tracking-wide border border-slate-400 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white hover:border-white hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer focus:outline-none"
            >
              Get started
            </button>
          )}
        </div>
      </div>

      {/* Central Content Column */}
      <div className="relative z-10 flex flex-col items-center justify-center my-auto w-full max-w-2xl px-4 text-center" id="dashboard-central">
        
        {/* BIG LOGO */}
        <motion.h1
          id="feynman-logo"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-6xl md:text-8xl font-black tracking-[0.25em] text-[#faf9ff] pl-[0.25em]"
          style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
        >
          FEYNMAN
        </motion.h1>

        {/* Slogan */}
        <motion.p
          id="feynman-slogan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-slate-400 text-lg md:text-xl font-normal italic tracking-wider mt-4"
        >
          teach it to learn it
        </motion.p>

        {/* Toggle between Upload and Paste */}
        <motion.div
          id="dashboard-input-tabs"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="flex bg-[#050518] p-1 rounded-full border border-purple-500/15 mt-8 relative z-10 shadow-[0_0_15px_rgba(168,85,247,0.05)]"
        >
          <button
            id="tab-btn-upload"
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wider transition-all duration-300 cursor-pointer flex items-center space-x-1.5 ${
              activeTab === "upload"
                ? "bg-[#221035] text-purple-200 border border-purple-500/25 shadow-inner"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
            onClick={() => setActiveTab("upload")}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload File</span>
          </button>
          <button
            id="tab-btn-paste"
            className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-wider transition-all duration-300 cursor-pointer flex items-center space-x-1.5 ${
              activeTab === "paste"
                ? "bg-[#221035] text-purple-200 border border-purple-500/25 shadow-inner"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
            onClick={() => setActiveTab("paste")}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Paste Text / Notes</span>
          </button>
        </motion.div>

        {activeTab === "upload" ? (
          /* Upload Dropzone Widget */
          <motion.div
            id="upload-widget"
            key="upload-panel"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            onClick={triggerFileInput}
            className={`w-full max-w-lg mt-8 rounded-xl border border-purple-500/20 bg-[#06061c]/60 p-8 md:p-11 transition-all duration-300 relative group cursor-pointer ${
              isDragging 
                ? "border-purple-400 bg-purple-950/20 scale-[1.01] shadow-[0_0_30px_rgba(168,85,247,0.15)]" 
                : "hover:border-purple-500/35 hover:bg-purple-950/5 hover:-translate-y-0.5 shadow-[0_0_20px_rgba(0,0,0,0.3)]"
            }`}
          >
            {/* Corner HUD decorations */}
            <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t border-l border-purple-400/60 group-hover:border-purple-400" />
            <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t border-r border-purple-400/60 group-hover:border-purple-400" />
            <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b border-l border-purple-400/60 group-hover:border-purple-400" />
            <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b border-r border-purple-400/60 group-hover:border-purple-400" />

            {/* Dotted border line */}
            <div className="absolute inset-1.5 border border-dashed border-purple-500/15 rounded-lg pointer-events-none group-hover:border-purple-500/25 transition-colors" />

            <input
              type="file"
              id="file-uploader"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
              accept=".txt,.md,.mdx,.json,.csv,.png,.jpg,.jpeg,.pdf"
            />

            <div className="flex flex-col items-center justify-center relative z-10 space-y-5" id="upload-widget-content">
              {/* Upload Button */}
              <motion.button
                id="upload-badge-button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className="py-2 px-5 rounded-lg bg-[#221035] border border-purple-500/30 group-hover:border-purple-400 group-hover:bg-[#2d1449] text-purple-200 group-hover:text-white transition-all text-sm font-medium flex items-center space-x-2 shadow-inner shadow-purple-500/10 cursor-pointer pointer-events-none"
              >
                <Upload className="w-4 h-4 text-purple-400 group-hover:text-purple-300" id="icon-inner-upload" />
                <span>Upload File</span>
              </motion.button>

              {/* Hint label */}
              <p className="text-slate-400 text-[13px] font-medium tracking-wide" id="upload-badge-label">
                Drop your documents here or click to upload
              </p>
            </div>
          </motion.div>
        ) : (
          /* Paste Plain Text Widget */
          <motion.div
            id="paste-widget"
            key="paste-panel"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-lg mt-8 rounded-xl border border-purple-500/20 bg-[#06061c]/70 p-6 md:p-8 text-left relative group shadow-[0_0_20px_rgba(0,0,0,0.3)]"
          >
            {/* Corner HUD decorations */}
            <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t border-l border-purple-400/60 group-hover:border-purple-400" />
            <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t border-r border-purple-400/60 group-hover:border-purple-400" />
            <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b border-l border-purple-400/60 group-hover:border-purple-400" />
            <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b border-r border-purple-400/60 group-hover:border-purple-400" />

            {/* Subtle border line */}
            <div className="absolute inset-1.5 border border-[#1b1b42]/20 rounded-lg pointer-events-none" />

            <div className="space-y-4 relative z-10" id="paste-form-container">
              <div>
                <label className="block text-[10px] uppercase font-bold tracking-wider text-purple-400 mb-1.5 font-mono">Topic / Title</label>
                <input
                  type="text"
                  placeholder="e.g. Photoelectric Effect, Deep Learning Math..."
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#030310]/90 border border-[#1b1b42]/70 rounded-lg text-slate-100 text-xs placeholder-slate-600 focus:outline-none focus:border-purple-500/50 transition-all font-semibold"
                  id="paste-title-input"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tracking-wider text-purple-400 mb-1.5 font-mono">Concept / Text Content</label>
                <textarea
                  placeholder="Paste your notes, transcript, chapter summary or explanation text here..."
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  className="w-full h-32 px-3.5 py-2.5 bg-[#030310]/90 border border-[#1b1b42]/70 rounded-lg text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-purple-500/50 resize-none font-sans leading-relaxed"
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
                  className={`px-5 py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all duration-300 flex items-center justify-center cursor-pointer ${
                    pastedText.trim()
                      ? "bg-[#221035] border border-purple-500/40 text-purple-200 hover:text-white hover:bg-[#2d1449] hover:border-purple-400 active:scale-98 shadow-[0_0_12px_rgba(168,85,247,0.15)]"
                      : "bg-[#050516] border border-slate-900/60 text-slate-600 cursor-not-allowed"
                  }`}
                >
                  Submit
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </div>

      {/* "Get Started" Custom Landing screen modal matching mockup style precisely */}
      {showStartModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020207]/85 backdrop-blur-md p-4 animate-fadeIn"
          onClick={() => setShowStartModal(false)}
          id="get-started-modal"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.stopPropagation()} // Prevent close on card click
            className="w-full max-w-[370px] rounded-[32px] bg-white p-8 md:p-9 shadow-2xl shadow-black/30 relative text-left"
            id="get-started-card"
          >
            {/* Small subtle close button */}
            <button
              onClick={() => setShowStartModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-800 transition-colors cursor-pointer text-base p-1 focus:outline-none"
              title="Close modal"
              id="get-started-close-btn"
            >
              ✕
            </button>

            {authStage === "idle" ? (
              <div className="py-2">
                {/* Heading Block */}
                {isSignUp ? (
                  <div className="mb-6 select-none">
                    <h2 className="text-[26px] font-bold tracking-tight text-[#16161a] leading-tight" id="get-started-title">
                      Welcome to Feynman
                    </h2>
                  </div>
                ) : (
                  <div className="mb-6 select-none">
                    <h2 className="text-[26px] font-bold tracking-tight text-[#16161a] leading-tight" id="get-started-title">
                      Welcome back
                    </h2>
                  </div>
                )}

                {/* Form fields */}
                {authError && (
                  <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-[18px] text-red-600 text-xs font-semibold font-sans mb-5 leading-normal break-words" id="auth-error-banner">
                    {authError}
                  </div>
                )}

                <form 
                  onSubmit={handleAuthSubmit}
                  className="space-y-4"
                  id="get-started-form"
                >
                  {/* Full Name field (Sign Up Only) */}
                  {isSignUp && (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-slate-500" strokeWidth={1.8} />
                      </div>
                      <input
                        required
                        type="text"
                        placeholder="Full Name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full bg-[#f4f4f6] text-[#1a1a1e] placeholder-slate-400 font-medium font-sans text-xs md:text-sm py-4 pl-13 pr-5 rounded-[22px] focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all border border-transparent"
                        id="started-fullname-input"
                      />
                    </div>
                  )}

                  {/* Email Input */}
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-slate-500" strokeWidth={1.8} />
                    </div>
                    <input
                      required
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-[#f4f4f6] text-[#1a1a1e] placeholder-slate-400 font-medium font-sans text-xs md:text-sm py-4 pl-13 pr-5 rounded-[22px] focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all border border-transparent"
                      id="started-email-input"
                    />
                  </div>

                  {/* Password Input */}
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-slate-500" strokeWidth={1.8} />
                    </div>
                    <input
                      required
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-[#f4f4f6] text-[#1a1a1e] placeholder-slate-400 font-medium font-sans text-xs md:text-sm py-4 pl-13 pr-5 rounded-[22px] focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all border border-transparent"
                      id="started-password-input"
                    />
                  </div>

                  {/* Confirm Password Input (Sign Up Only) */}
                  {isSignUp && (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                        <Lock className="h-5 w-5 text-slate-500" strokeWidth={1.8} />
                      </div>
                      <input
                        required
                        type="password"
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-[#f4f4f6] text-[#1a1a1e] placeholder-slate-400 font-medium font-sans text-xs md:text-sm py-4 pl-13 pr-5 rounded-[22px] focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all border border-transparent"
                        id="started-confirmpassword-input"
                      />
                    </div>
                  )}

                  {/* Forgot Password Link (Login Only) */}
                  {!isSignUp && (
                    <div className="flex items-center justify-between px-1">
                      {forgotPasswordSent ? (
                        <span className="text-[11px] font-sans text-green-600 font-medium">✓ Reset email sent successfully</span>
                      ) : (
                        <div />
                      )}
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-[12px] text-[#ea580c] hover:text-[#d94e06] font-medium font-sans cursor-pointer focus:outline-none hover:underline"
                        id="btn-forgot-password"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  )}

                  {/* Action form Button in Coral/Orange color with rounded border */}
                  <button
                    type="submit"
                    className="w-full bg-[#ea580c] hover:bg-[#d94e06] active:scale-[0.98] transition-all text-white font-semibold font-sans py-4 rounded-[22px] shadow-md shadow-orange-600/10 cursor-pointer focus:outline-none text-[15px] mt-2 block text-center"
                    id="get-started-primary-btn"
                  >
                    {isSignUp ? "Create Account" : "Continue Learning"}
                  </button>
                </form>

                {/* Styled ────────────── divider */}
                <div className="relative flex py-4 items-center select-none" id="auth-divider">
                  <div className="flex-grow border-t border-slate-200"></div>
                  <span className="flex-shrink mx-4 text-slate-300 font-sans text-[11px]">──────────────</span>
                  <div className="flex-grow border-t border-slate-200"></div>
                </div>

                {/* Google Sign in Button */}
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  className="w-full bg-white border border-slate-200/80 hover:bg-slate-50 active:scale-[0.98] transition-all text-[#374151] font-semibold font-sans py-3.5 rounded-[22px] cursor-pointer focus:outline-none text-[14px] flex items-center justify-center"
                  id="get-started-google-btn"
                >
                  <svg className="w-4.5 h-4.5 mr-2.5" viewBox="0 0 24 24">
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

                {/* Direct helper redirection toggler link matching mockup "Already Have An Account? Login" */}
                <div className="text-center mt-6">
                  <button
                    onClick={() => setIsSignUp(!isSignUp)}
                    className="text-[12px] text-slate-500 hover:text-slate-800 transition-colors font-medium font-sans cursor-pointer focus:outline-none"
                    id="get-started-toggle-btn"
                  >
                    {isSignUp ? (
                      <>
                        Already Have An Account? <span className="text-[#ea580c] hover:text-[#d94e06] font-bold">Login</span>
                      </>
                    ) : (
                      <>
                        Don't Have An Account? <span className="text-[#ea580c] hover:text-[#d94e06] font-bold">Sign Up</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : authStage === "loading" ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-slate-500 font-sans font-medium tracking-wide">Establishing secure {authType === "Google Sync" ? "Google key" : authType} session...</p>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 font-sans">
                <div className="w-10 h-10 rounded-full border border-green-500/30 bg-green-500/5 flex items-center justify-center text-green-600">
                  ✓
                </div>
                <p className="text-sm text-slate-800 font-semibold tracking-wide">Welcome to Feynman Arena!</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Secure Link Established</p>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Footer removed */}
    </div>
  );
}
