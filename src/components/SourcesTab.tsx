import React, { useState, useEffect } from "react";
import { UploadedFile, Concept, StudyResource, ResourceCategory, SourcesResponse } from "../types";
import { 
  BookOpen, 
  Search, 
  ExternalLink, 
  Sparkles, 
  RefreshCw, 
  FileText, 
  Video, 
  Bookmark, 
  GraduationCap, 
  Compass, 
  Layers, 
  AlertCircle,
  FolderOpen,
  CheckCircle2,
  Share2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SourcesTabProps {
  file: UploadedFile;
  concepts: Concept[];
  allFiles?: UploadedFile[];
}

const CATEGORIES: ResourceCategory[] = [
  "All",
  "Articles",
  "Documentation",
  "Videos",
  "Research Papers",
  "Further Reading"
];

export default function SourcesTab({ file, concepts, allFiles = [] }: SourcesTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<ResourceCategory>("All");
  const [searchFilter, setSearchFilter] = useState("");
  const [resources, setResources] = useState<StudyResource[]>([]);
  const [aiExplanation, setAiExplanation] = useState<string>("");
  const [topics, setTopics] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedResourceIds, setSavedResourceIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Cache key per document so we don't refetch constantly unless refreshed
  const cacheKey = `feynman_sources_${file.id}`;

  const fetchSources = async (customQuery?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/document/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileContent: file.content,
          concepts: concepts.map(c => ({ title: c.title, summary: c.summary })),
          searchQuery: customQuery || searchFilter || undefined
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${response.status}`);
      }

      const data: SourcesResponse = await response.json();
      setResources(data.resources || []);
      setAiExplanation(data.aiExplanation || "These educational resources are curated specifically to supplement the key concepts found in your uploaded study material.");
      setTopics(data.topics || []);

      // Cache the result for this document if standard query
      if (!customQuery && !searchFilter) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch (e) {
          console.warn("Could not save to localStorage", e);
        }
      }
    } catch (err: any) {
      console.error("Error fetching sources:", err);
      setError(err.message || "Failed to load curated sources. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load: check cache first, otherwise fetch
  useEffect(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed: SourcesResponse = JSON.parse(cached);
        if (parsed.resources && parsed.resources.length > 0) {
          setResources(parsed.resources);
          setAiExplanation(parsed.aiExplanation || "");
          setTopics(parsed.topics || []);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed reading cached sources", e);
    }

    fetchSources();
  }, [file.id]);

  // Load saved bookmarks from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`feynman_saved_resources_${file.id}`);
      if (saved) {
        setSavedResourceIds(new Set(JSON.parse(saved)));
      }
    } catch (e) {
      // ignore
    }
  }, [file.id]);

  const toggleSaveResource = (id: string) => {
    setSavedResourceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem(`feynman_saved_resources_${file.id}`, JSON.stringify(Array.from(next)));
      } catch (e) {
        // ignore
      }
      return next;
    });
  };

  const handleCopyLink = (url: string, id: string) => {
    navigator.clipboard?.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter resources based on category and search text
  const filteredResources = resources.filter(res => {
    const matchesCategory = selectedCategory === "All" || res.type === selectedCategory;
    const query = searchFilter.toLowerCase().trim();
    const matchesSearch = !query || 
      res.title.toLowerCase().includes(query) ||
      res.description.toLowerCase().includes(query) ||
      res.source.toLowerCase().includes(query) ||
      res.relevanceReason.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  // Category badge helper
  const getCategoryBadge = (type: string) => {
    switch (type) {
      case "Documentation":
        return {
          icon: <BookOpen className="w-3.5 h-3.5 text-blue-400" />,
          color: "bg-blue-500/10 text-blue-300 border-blue-500/25"
        };
      case "Videos":
        return {
          icon: <Video className="w-3.5 h-3.5 text-rose-400" />,
          color: "bg-rose-500/10 text-rose-300 border-rose-500/25"
        };
      case "Research Papers":
        return {
          icon: <GraduationCap className="w-3.5 h-3.5 text-amber-400" />,
          color: "bg-amber-500/10 text-amber-300 border-amber-500/25"
        };
      case "Articles":
        return {
          icon: <FileText className="w-3.5 h-3.5 text-emerald-400" />,
          color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
        };
      default:
        return {
          icon: <Sparkles className="w-3.5 h-3.5 text-purple-400" />,
          color: "bg-purple-500/10 text-purple-300 border-purple-500/25"
        };
    }
  };

  const hasMultipleFiles = allFiles && allFiles.length > 1;

  return (
    <motion.div
      key="sources-tab-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.25 }}
      className="max-w-6xl mx-auto w-full flex-1 flex flex-col space-y-6 pb-12"
      id="sources-tab-container"
    >
      {/* 1. Header Section */}
      <div className="bg-[#05051b]/70 border border-[#1b1b42]/70 rounded-2xl p-6 sm:p-7 relative overflow-hidden backdrop-blur-sm shadow-xl" id="sources-header-banner">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-[#d946ef]/10 via-purple-600/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2.5">
              <span className="w-2 h-2 rounded-full bg-[#d946ef] animate-pulse" />
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
                Explore More
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 font-medium">
              Discover additional resources related to your uploaded study material.
            </p>
            
            {/* Contextual Indicator */}
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-purple-950/60 border border-purple-500/25 text-purple-300">
                <FolderOpen className="w-3.5 h-3.5 text-[#d946ef]" />
                <span>
                  {hasMultipleFiles 
                    ? "Based on your uploaded study materials" 
                    : `Based on: ${file.name}`}
                </span>
              </span>

              {topics.length > 0 && topics.map((t, idx) => (
                <span 
                  key={idx} 
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-[#0e0e2e] border border-[#232356] text-slate-300 hover:border-purple-500/50 transition-colors cursor-default"
                >
                  #{t}
                </span>
              ))}
            </div>
          </div>

          {/* Action Button: Refresh Recommendations */}
          <div className="flex items-center space-x-2.5 self-start md:self-center">
            <button
              id="btn-refresh-sources"
              onClick={() => fetchSources()}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-[#140b24] hover:bg-[#1e0f38] border border-[#d946ef]/40 text-purple-200 text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50 shadow-[0_0_15px_rgba(217,70,239,0.1)] hover:shadow-[0_0_20px_rgba(217,70,239,0.25)]"
              title="Refresh recommendations with fresh search"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#d946ef] ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Curating..." : "Refresh Sources"}</span>
            </button>
          </div>
        </div>

        {/* AI Explanation Banner */}
        {aiExplanation && (
          <div className="mt-5 pt-4 border-t border-[#1b1b42]/50 flex items-start space-x-3 text-xs" id="sources-ai-explanation">
            <div className="p-1.5 rounded-lg bg-[#1a0e2e] border border-[#d946ef]/30 text-[#d946ef] shrink-0 mt-0.5">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="font-bold text-slate-200 uppercase tracking-wider text-[11px] font-mono mb-0.5 flex items-center gap-1.5">
                <span>Why these sources?</span>
              </div>
              <p className="text-slate-300 leading-relaxed font-sans">
                {aiExplanation}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Controls Bar: Categories & Search Filter */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#05051b]/60 border border-[#1b1b42]/70 rounded-xl p-3" id="sources-controls-bar">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5" id="category-filter-pills">
          {CATEGORIES.map(category => {
            const count = category === "All" 
              ? resources.length 
              : resources.filter(r => r.type === category).length;
            const isActive = selectedCategory === category;

            return (
              <button
                key={category}
                id={`filter-cat-${category.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center space-x-1.5 ${
                  isActive
                    ? "bg-[#1e0e28] border border-[#d946ef]/70 text-white shadow-[0_0_12px_rgba(217,70,239,0.2)]"
                    : "bg-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"
                }`}
              >
                <span>{category}</span>
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isActive ? "bg-[#d946ef]/25 text-purple-200" : "bg-[#14143a] text-slate-400"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Keyword Search within Sources */}
        <div className="relative min-w-[240px] md:w-72" id="sources-search-box">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            id="input-search-sources"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search within sources..."
            className="w-full bg-[#030312] border border-[#1b1b42] focus:border-[#d946ef]/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none transition-all"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-mono"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 3. Resources Grid or States */}
      {isLoading ? (
        /* Skeleton Loading Cards */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="sources-loading-skeletons">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-[#05051b]/40 border border-[#1b1b42]/40 rounded-xl p-5 space-y-4 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="h-5 w-24 bg-purple-950/40 rounded-md" />
                <div className="h-4 w-28 bg-slate-800/40 rounded" />
              </div>
              <div className="h-5 w-3/4 bg-slate-800/60 rounded" />
              <div className="space-y-1.5">
                <div className="h-3 w-full bg-slate-900/60 rounded" />
                <div className="h-3 w-5/6 bg-slate-900/60 rounded" />
              </div>
              <div className="h-14 bg-purple-950/20 rounded-lg border border-purple-900/20" />
              <div className="h-8 w-32 bg-purple-900/40 rounded-lg" />
            </div>
          ))}
        </div>
      ) : error ? (
        /* Error State with Retry */
        <div className="bg-[#0e0717] border border-rose-500/30 rounded-2xl p-8 text-center space-y-4 max-w-lg mx-auto" id="sources-error-state">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/25 flex items-center justify-center mx-auto text-rose-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Couldn't Retrieve External Sources</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">{error}</p>
          </div>
          <button
            onClick={() => fetchSources()}
            className="px-5 py-2 rounded-xl bg-purple-900/50 hover:bg-purple-800/70 border border-[#d946ef]/50 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center space-x-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      ) : filteredResources.length === 0 ? (
        /* Empty State */
        <div className="bg-[#05051b]/45 border border-[#1b1b42]/70 rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-4" id="sources-empty-state">
          <div className="w-12 h-12 rounded-2xl bg-purple-950/40 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Compass className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-200">No resources found</h3>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            {searchFilter 
              ? `No resources matched your search filter "${searchFilter}". Try clearing your search.`
              : `No resources available in the "${selectedCategory}" category.`}
          </p>
          {(searchFilter || selectedCategory !== "All") && (
            <button
              onClick={() => {
                setSearchFilter("");
                setSelectedCategory("All");
              }}
              className="px-4 py-1.5 rounded-lg bg-[#140b24] border border-[#d946ef]/40 text-purple-200 text-xs font-bold hover:bg-[#1e0f38] transition-all cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        /* Resource Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="sources-cards-grid">
          {filteredResources.map((resource) => {
            const badge = getCategoryBadge(resource.type);
            const isSaved = savedResourceIds.has(resource.id);
            const isCopied = copiedId === resource.id;

            return (
              <motion.div
                key={resource.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className="bg-[#05051b]/70 border border-[#1b1b42]/70 hover:border-[#d946ef]/45 rounded-xl p-5 flex flex-col justify-between transition-all group backdrop-blur-sm shadow-md hover:shadow-[0_4px_25px_rgba(217,70,239,0.12)] relative"
                id={`source-card-${resource.id}`}
              >
                {/* Top Row: Category Pill & Source Domain */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border ${badge.color}`}>
                      {badge.icon}
                      <span>{resource.type}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="truncate max-w-[140px] sm:max-w-[180px]">{resource.source}</span>
                    </span>
                  </div>

                  {/* Bookmark Button */}
                  <button
                    onClick={() => toggleSaveResource(resource.id)}
                    title={isSaved ? "Saved to your list" : "Save for later"}
                    className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                      isSaved 
                        ? "bg-[#d946ef]/20 border-[#d946ef]/50 text-[#d946ef]" 
                        : "bg-[#050518] border-[#1b1b42] text-slate-500 hover:text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${isSaved ? "fill-current" : ""}`} />
                  </button>
                </div>

                {/* Resource Title */}
                <h3 className="text-sm font-bold text-slate-100 group-hover:text-purple-200 transition-colors leading-snug mb-2" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
                  {resource.title}
                </h3>

                {/* Short Description */}
                <p className="text-xs text-slate-300 leading-relaxed mb-4 flex-1">
                  {resource.description}
                </p>

                {/* Why it is relevant (Lavender/Purple Box) */}
                <div className="bg-[#0e071f]/80 border border-purple-500/20 rounded-lg p-3 mb-4 text-xs">
                  <div className="flex items-center space-x-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-purple-300 mb-1">
                    <Sparkles className="w-3 h-3 text-[#d946ef]" />
                    <span>Why this is useful</span>
                  </div>
                  <p className="text-slate-300 text-[11px] sm:text-xs leading-relaxed font-sans">
                    {resource.relevanceReason}
                  </p>
                </div>

                {/* Card Footer: Open Resource Button & Share */}
                <div className="pt-2 border-t border-[#18183c]/50 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-slate-500 truncate max-w-[180px]">
                    {resource.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                  </span>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleCopyLink(resource.url, resource.id)}
                      title="Copy URL"
                      className="p-1.5 rounded-lg bg-[#050518] border border-[#1b1b42] text-slate-400 hover:text-purple-300 hover:border-purple-500/40 transition-all cursor-pointer text-xs flex items-center gap-1"
                    >
                      {isCopied ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[10px] text-emerald-400 font-mono">Copied</span>
                        </>
                      ) : (
                        <Share2 className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-1.5 rounded-lg bg-[#190a2a] hover:bg-[#280e43] border border-[#d946ef]/60 text-purple-200 hover:text-white text-xs font-bold transition-all inline-flex items-center space-x-1.5 cursor-pointer shadow-[0_0_12px_rgba(217,70,239,0.15)] hover:shadow-[0_0_16px_rgba(217,70,239,0.3)]"
                      id={`btn-open-resource-${resource.id}`}
                    >
                      <span>Open Resource</span>
                      <ExternalLink className="w-3.5 h-3.5 text-[#d946ef]" />
                    </a>
                  </div>
                </div>

              </motion.div>
            );
          })}
        </div>
      )}

      {/* Footer Info Banner */}
      <div className="mt-4 p-4 rounded-xl bg-[#040416]/50 border border-[#18183c]/50 flex flex-col sm:flex-row items-center justify-between text-slate-500 text-[11px] font-mono gap-2">
        <div className="flex items-center space-x-2">
          <BookOpen className="w-3.5 h-3.5 text-purple-400" />
          <span>FEYMANN Knowledge Discovery • Sources curated based on your uploaded study notes</span>
        </div>
        <div className="flex items-center space-x-3 text-slate-400">
          <span>{filteredResources.length} resources available</span>
          <span>•</span>
          <span>{savedResourceIds.size} saved</span>
        </div>
      </div>

    </motion.div>
  );
}
