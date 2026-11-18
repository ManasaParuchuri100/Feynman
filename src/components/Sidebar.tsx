import React from "react";
import { UploadedFile } from "../types";
import { 
  FileText, 
  Image as ImageIcon, 
  Trash2, 
  Upload, 
  PanelLeftClose, 
  FileCode, 
  FileSpreadsheet,
  FolderOpen,
  Presentation
} from "lucide-react";
import { motion } from "motion/react";

interface SidebarProps {
  files: UploadedFile[];
  activeFileId: string | null;
  onSelectFile: (file: UploadedFile) => void;
  onDeleteFile: (id: string, e: React.MouseEvent) => void;
  onUploadClick: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  files,
  activeFileId,
  onSelectFile,
  onDeleteFile,
  onUploadClick,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const isPresentation = (file: UploadedFile) => {
    const lower = file.name.toLowerCase();
    return (
      file.type.includes("presentation") ||
      file.type.includes("powerpoint") ||
      lower.endsWith(".ppt") ||
      lower.endsWith(".pptx")
    );
  };

  const getFileIcon = (file: UploadedFile) => {
    const type = file.type;
    if (isPresentation(file)) return <Presentation className="w-4 h-4 text-orange-500 dark:text-orange-400 shrink-0" id="icon-ppt" />;
    if (type.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0" id="icon-image" />;
    if (type.includes("json") || type.includes("javascript") || type.includes("typescript")) 
      return <FileCode className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" id="icon-code" />;
    if (type.includes("csv") || type.includes("spreadsheet")) 
      return <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" id="icon-sheet" />;
    return <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" id="icon-text" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <motion.aside
      id="app-sidebar"
      initial={false}
      animate={{ 
        width: isCollapsed ? 0 : 288,
        opacity: isCollapsed ? 0 : 1
      }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="h-screen border-r border-slate-200/90 dark:border-white/[0.07] bg-[#F4F4F8] dark:bg-[#0A0A16] flex flex-col justify-between overflow-hidden shrink-0 transition-colors duration-200"
    >
      {/* Sidebar Header */}
      <div className="px-5 py-4 border-b border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between" id="sidebar-header">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap" id="sidebar-title">
            Study Library
          </h3>
          {files.length > 0 && (
            <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
              {files.length}
            </span>
          )}
        </div>
        <button
          id="btn-collapse-sidebar"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/[0.06] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          title="Collapse Sidebar"
          aria-label="Collapse Sidebar"
        >
          <PanelLeftClose className="w-4 h-4" id="icon-collapse" />
        </button>
      </div>

      {/* Uploads List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1" id="sidebar-list-container">
        {files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2" id="empty-sidebar">
            <div className="w-10 h-10 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.07] flex items-center justify-center text-slate-400 dark:text-slate-500">
              <FolderOpen className="w-4 h-4" />
            </div>
            <span className="text-slate-600 dark:text-slate-400 text-xs font-medium" id="lbl-no-uploads">
              No study materials yet
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed max-w-[180px]">
              Upload a PDF, note, or diagram to begin.
            </span>
          </div>
        ) : (
          files.map((file) => {
            const isActive = file.id === activeFileId;
            return (
              <div
                key={file.id}
                id={`sidebar-item-${file.id}`}
                onClick={() => onSelectFile(file)}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                  isActive
                    ? "bg-white dark:bg-violet-500/[0.14] border border-slate-200/90 dark:border-violet-500/35 text-slate-950 dark:text-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    : "hover:bg-white/70 dark:hover:bg-white/[0.04] border border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden min-w-0" id={`sidebar-item-content-${file.id}`}>
                  {getFileIcon(file)}
                  <div className="flex flex-col truncate min-w-0" id={`sidebar-item-meta-${file.id}`}>
                    <span className="text-[13px] font-medium truncate" id={`sidebar-item-name-${file.id}`}>
                      {file.name}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 mt-0.5" id={`sidebar-item-size-${file.id}`}>
                      <span>{formatSize(file.size)}</span>
                      {file.ragStage && file.ragStage !== "ready" && file.ragStage !== "error" && (
                        <>
                          <span>·</span>
                          <span className="text-violet-600 dark:text-violet-400 font-semibold truncate">
                            {file.ragProgress ?? 0}%
                          </span>
                        </>
                      )}
                      {file.ragStage === "ready" && typeof file.pageCount === "number" && file.pageCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {file.pageCount}{isPresentation(file) ? "s" : "p"}
                          </span>
                        </>
                      )}
                      {file.ragStage === "error" && (
                        <>
                          <span>·</span>
                          <span className="text-rose-500 font-semibold">ERR</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  id={`btn-delete-file-${file.id}`}
                  onClick={(e) => onDeleteFile(file.id, e)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/15 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-all ml-1.5 shrink-0 cursor-pointer"
                  title="Remove document"
                  aria-label={`Remove ${file.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" id={`icon-delete-${file.id}`} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer Link */}
      <div className="p-4 border-t border-slate-200/80 dark:border-white/[0.06]" id="sidebar-footer">
        <button
          id="btn-sidebar-upload"
          onClick={onUploadClick}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-200/90 dark:border-white/[0.08] text-slate-700 dark:text-slate-200 hover:border-violet-300 dark:hover:border-violet-500/40 hover:text-violet-700 dark:hover:text-white transition-all text-xs font-semibold cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.03)] whitespace-nowrap"
        >
          <Upload className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" id="icon-side-upload" />
          <span>Add more files</span>
        </button>
      </div>
    </motion.aside>
  );
}
