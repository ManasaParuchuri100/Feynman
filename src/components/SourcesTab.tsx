import React, { useState, useEffect } from "react";
import { UploadedFile, Concept, StudyResource, ResourceCategory, SourcesResponse } from "../types";
import { authFetch } from "../lib/api";
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
  AlertCircle,
  CheckCircle2,
  Share2
} from "lucide-react";
import { motion } from "motion/react";

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

  const cacheKey = `feynman_sources_${file.id}`;

  const fetchSources = async (customQuery?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authFetch("/api/document/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          fileName: file.name,
          fileType: file.type,
          fileContent: file.content && file.content.length < 300_000 && !file.content.startsWith("/api/") ? file.content : undefined,
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`feynman_saved_resources_${file.id}`);
      if (saved) {
        setSavedResourceIds(new Set(JSON.parse(saved)));
      }
    } catch {
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
      } catch {
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

  const getCategoryMeta = (type: string) => {
    switch (type) {
      case "Documentation":
        return {
          icon: <BookOpen className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />,
          textClass: "text-sky-700 dark:text-sky-400"
        };
      case "Videos":
        return {
          icon: <Video className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />,
          textClass: "text-rose-700 dark:text-rose-400"
        };
      case "Research Papers":
        return {
          icon: <GraduationCap className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />,
          textClass: "text-amber-700 dark:text-amber-400"
        };
      case "Articles":
        return {
          icon: <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
          textClass: "text-emerald-700 dark:text-emerald-400"
        };
      default:
        return {
          icon: <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />,
          textClass: "text-violet-700 dark:text-violet-400"
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
      transition={{ duration: 0.2 }}
      className="max-w-5xl mx-auto w-full flex-1 flex flex-col space-y-6 pb-12"
      id="sources-tab-container"
    >
      {/* 1. Header Section */}
      <div className="bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-6 sm:p-7 shadow-[0_1px_3px_rgba(15,23,42,0.04)] dark:shadow-none" id="sources-header-banner">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tracking-tight">
              Explore More
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              Discover additional resources related to your uploaded study material.
            </p>

            {/* Unboxed Clean Contextual Metadata */}
            <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-violet-700 dark:text-violet-400">
                {hasMultipleFiles 
                  ? "Based on your uploaded study materials" 
                  : `Based on: ${file.name}`}
              </span>
              {topics.length > 0 && topics.map((t, idx) => (
                <React.Fragment key={idx}>
                  <span aria-hidden="true">·</span>
                  <span>{t}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="flex items-center self-start shrink-0">
            <button
              id="btn-refresh-sources"
              onClick={() => fetchSources()}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.05] hover:bg-slate-100 dark:hover:bg-white/[0.09] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title="Refresh recommendations"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-violet-600 dark:text-violet-400 ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Curating..." : "Refresh Sources"}</span>
            </button>
          </div>
        </div>

        {/* AI Explanation Note */}
        {aiExplanation && (
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/[0.06] flex items-start gap-3 text-xs" id="sources-ai-explanation">
            <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-slate-200">
                Why these sources?
              </div>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                {aiExplanation}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Controls Bar: Segmented Categories & Search Filter */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-xl p-2.5 shadow-2xs dark:shadow-none" id="sources-controls-bar">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5" id="category-filter-pills">
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
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                  isActive
                    ? "bg-violet-600 text-white shadow-2xs"
                    : "bg-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.05]"
                }`}
              >
                <span>{category}</span>
                {count > 0 && (
                  <span className={`text-[11px] font-mono tabular-nums ${
                    isActive ? "text-violet-100" : "text-slate-400 dark:text-slate-500"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[230px] md:w-64" id="sources-search-box">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            id="input-search-sources"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search within sources..."
            className="w-full bg-slate-50 dark:bg-[#080814] border border-slate-200 dark:border-white/[0.08] focus:border-violet-500 dark:focus:border-violet-400 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-all"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-mono cursor-pointer"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 3. Resources Grid or States */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="sources-loading-skeletons">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white dark:bg-[#0E0E1D] border border-slate-200/80 dark:border-white/[0.06] rounded-2xl p-5 space-y-4 animate-pulse">
              <div className="h-3 w-36 bg-slate-200 dark:bg-white/10 rounded" />
              <div className="h-5 w-3/4 bg-slate-200 dark:bg-white/10 rounded" />
              <div className="space-y-2">
                <div className="h-3 w-full bg-slate-100 dark:bg-white/[0.05] rounded" />
                <div className="h-3 w-5/6 bg-slate-100 dark:bg-white/[0.05] rounded" />
              </div>
              <div className="h-14 bg-slate-50 dark:bg-white/[0.03] rounded-xl" />
              <div className="h-8 w-32 bg-slate-200 dark:bg-white/10 rounded-lg" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-white dark:bg-[#0E0E1D] border border-rose-200 dark:border-rose-500/30 rounded-2xl p-8 text-center space-y-4 max-w-lg mx-auto shadow-xs" id="sources-error-state">
          <div className="w-11 h-11 rounded-full bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 flex items-center justify-center mx-auto text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Couldn&apos;t Retrieve External Sources</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">{error}</p>
          </div>
          <button
            onClick={() => fetchSources()}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-3" id="sources-empty-state">
          <div className="w-11 h-11 rounded-2xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200/80 dark:border-violet-500/20 flex items-center justify-center text-violet-600 dark:text-violet-400">
            <Compass className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">No resources found</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
            {searchFilter 
              ? `No resources matched "${searchFilter}". Try clearing your search.`
              : `No resources available in the "${selectedCategory}" category.`}
          </p>
          {(searchFilter || selectedCategory !== "All") && (
            <button
              onClick={() => {
                setSearchFilter("");
                setSelectedCategory("All");
              }}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="sources-cards-grid">
          {filteredResources.map((resource) => {
            const meta = getCategoryMeta(resource.type);
            const isSaved = savedResourceIds.has(resource.id);
            const isCopied = copiedId === resource.id;

            return (
              <motion.div
                key={resource.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="bg-white dark:bg-[#0E0E1D] border border-slate-200/90 dark:border-white/[0.08] hover:border-violet-300 dark:hover:border-violet-500/40 rounded-2xl p-5 flex flex-col justify-between transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:shadow-md dark:shadow-none"
                id={`source-card-${resource.id}`}
              >
                <div>
                  {/* Quiet 1-line kicker metadata */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-1.5 text-xs min-w-0">
                      {meta.icon}
                      <span className={`font-semibold ${meta.textClass} whitespace-nowrap`}>{resource.type}</span>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-500 dark:text-slate-400 truncate font-mono text-[11px]">{resource.source}</span>
                    </div>

                    <button
                      onClick={() => toggleSaveResource(resource.id)}
                      title={isSaved ? "Saved to your list" : "Save for later"}
                      aria-label={isSaved ? "Remove bookmark" : "Bookmark resource"}
                      className={`p-1.5 rounded-lg border transition-all cursor-pointer shrink-0 ${
                        isSaved 
                          ? "bg-violet-50 dark:bg-violet-500/15 border-violet-300 dark:border-violet-500/40 text-violet-600 dark:text-violet-400" 
                          : "bg-transparent border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.05]"
                      }`}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${isSaved ? "fill-current" : ""}`} />
                    </button>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm sm:text-[15px] font-bold text-slate-950 dark:text-white leading-snug mb-2">
                    {resource.title}
                  </h3>

                  {/* Short Description */}
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                    {resource.description}
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Why it is relevant */}
                  <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/[0.06] rounded-xl p-3 text-xs">
                    <div className="font-semibold text-violet-700 dark:text-violet-400 mb-1 text-[11px]">
                      Why this is useful
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {resource.relevanceReason}
                    </p>
                  </div>

                  {/* Footer Actions */}
                  <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[180px]">
                      {resource.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                    </span>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleCopyLink(resource.url, resource.id)}
                        title="Copy URL"
                        className="p-2 rounded-lg bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer text-xs flex items-center gap-1"
                      >
                        {isCopied ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Copied</span>
                          </>
                        ) : (
                          <Share2 className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-2xs"
                        id={`btn-open-resource-${resource.id}`}
                      >
                        <span>Open Resource</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Footer Info */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between text-slate-500 dark:text-slate-400 text-xs gap-2">
        <span>Curated references grounded in your uploaded study notes</span>
        <div className="flex items-center gap-2 font-mono tabular-nums text-[11px]">
          <span>{filteredResources.length} resources</span>
          <span aria-hidden="true">·</span>
          <span>{savedResourceIds.size} saved</span>
        </div>
      </div>
    </motion.div>
  );
}
