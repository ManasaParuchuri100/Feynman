import React, { useRef } from "react";
import { UploadedFile } from "../types";
import { 
  FileText, 
  Image as ImageIcon, 
  Trash2, 
  Upload, 
  PanelLeftClose, 
  FileCode, 
  FileSpreadsheet, 
  File
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
  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-pink-400" id={`icon-image`} />;
    if (type.includes("json") || type.includes("javascript") || type.includes("typescript")) 
      return <FileCode className="w-4 h-4 text-yellow-400" id={`icon-code`} />;
    if (type.includes("csv") || type.includes("spreadsheet")) 
      return <FileSpreadsheet className="w-4 h-4 text-emerald-400" id={`icon-sheet`} />;
    return <FileText className="w-4 h-4 text-purple-400" id={`icon-text`} />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <motion.div
      id="app-sidebar"
      initial={false}
      animate={{ 
        width: isCollapsed ? 0 : 320,
        opacity: isCollapsed ? 0 : 1
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={`h-screen border-r border-[#15152e] bg-[#03030d] flex flex-col justify-between overflow-hidden shrink-0`}
    >
      {/* Sidebar Header */}
      <div className="p-5 border-b border-[#12122b] flex items-center justify-between" id="sidebar-header">
        <h3 className="text-sm font-semibold tracking-wider text-slate-200 uppercase" id="sidebar-title">
          Recent Uploads
        </h3>
        <button
          id="btn-collapse-sidebar"
          onClick={onToggleCollapse}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
          title="Collapse Sidebar"
        >
          <PanelLeftClose className="w-5 h-5" id="icon-collapse" />
        </button>
      </div>

      {/* Uploads List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5" id="sidebar-list-container">
        {files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6" id="empty-sidebar">
            <span className="text-slate-500 text-sm font-medium" id="lbl-no-uploads">
              No uploads yet
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
                className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                  isActive
                    ? "bg-purple-950/40 border border-purple-500/25 text-purple-100 shadow-[0_0_15px_rgba(147,51,234,0.07)]"
                    : "hover:bg-slate-900/40 border border-transparent text-slate-300 hover:text-slate-100"
                }`}
              >
                <div className="flex items-center space-x-3 overflow-hidden" id={`sidebar-item-content-${file.id}`}>
                  {getFileIcon(file.type)}
                  <div className="flex flex-col truncate" id={`sidebar-item-meta-${file.id}`}>
                    <span className="text-sm font-medium truncate" id={`sidebar-item-name-${file.id}`}>
                      {file.name}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-0.5" id={`sidebar-item-size-${file.id}`}>
                      {formatSize(file.size)}
                    </span>
                  </div>
                </div>

                <button
                  id={`btn-delete-file-${file.id}`}
                  onClick={(e) => onDeleteFile(file.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-purple-900/30 text-slate-500 hover:text-red-400 transition-all ml-2"
                  title="Remove document"
                >
                  <Trash2 className="w-3.5 h-3.5" id={`icon-delete-${file.id}`} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer Link */}
      <div className="p-4 border-t border-[#12122b]" id="sidebar-footer">
        <button
          id="btn-sidebar-upload"
          onClick={onUploadClick}
          className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg bg-transparent hover:bg-slate-900/60 text-slate-400 hover:text-white transition-all text-xs font-semibold cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 mr-2 text-slate-400" id="icon-side-upload" />
          Add more files
        </button>
      </div>
    </motion.div>
  );
}
