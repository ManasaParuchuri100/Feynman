import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AlertTriangle, Loader2 } from "lucide-react";
import { authFetch } from "../lib/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  source: string;
  fileName: string;
  onResolvedUrl?: (url: string | null) => void;
  onPageCountChange?: (count: number | null) => void;
}

interface PdfPageCanvasProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  totalPages: number;
  containerWidth: number;
  defaultAspectRatio: number;
  scrollRoot: HTMLDivElement | null;
}

function decodeDataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid PDF data URL format.");
  }

  const meta = dataUrl.slice(5, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);

  if (meta.includes(";base64") || !meta) {
    const cleaned = payload.replace(/\s+/g, "");
    const binaryString = atob(cleaned);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  const decoded = decodeURIComponent(payload);
  return new TextEncoder().encode(decoded);
}

function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  totalPages,
  containerWidth,
  defaultAspectRatio,
  scrollRoot,
}: PdfPageCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState<boolean>(pageNumber <= 2);
  const [aspectRatio, setAspectRatio] = useState<number>(defaultAspectRatio);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isRendered, setIsRendered] = useState<boolean>(false);

  useEffect(() => {
    const target = wrapperRef.current;
    if (!target) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsNearViewport(true);
            observer.disconnect();
            break;
          }
        }
      },
      {
        root: scrollRoot,
        rootMargin: "500px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!isNearViewport || containerWidth <= 0) return;

    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let pageProxy: pdfjsLib.PDFPageProxy | null = null;

    const renderPage = async () => {
      try {
        setPageError(null);
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        pageProxy = page;

        const baseViewport = page.getViewport({ scale: 1 });
        if (baseViewport.width > 0 && baseViewport.height > 0) {
          setAspectRatio(baseViewport.width / baseViewport.height);
        }

        const scale = Math.max(0.25, containerWidth / baseViewport.width);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          throw new Error("Could not acquire 2D canvas context.");
        }

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.max(1, Math.floor(viewport.width * outputScale));
        const pixelHeight = Math.max(1, Math.floor(viewport.height * outputScale));

        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, pixelWidth, pixelHeight);

        const transform =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform,
        });

        await renderTask.promise;
        if (!cancelled) {
          setIsRendered(true);
        }
      } catch (err: any) {
        if (
          cancelled ||
          err?.name === "RenderingCancelledException" ||
          err?.message?.includes("Rendering cancelled")
        ) {
          return;
        }
        console.error(`Error rendering PDF page ${pageNumber}:`, err);
        if (!cancelled) {
          setPageError(`Failed to render page ${pageNumber}.`);
        }
      } finally {
        if (pageProxy) {
          try {
            pageProxy.cleanup();
          } catch {
            // ignore cleanup errors
          }
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore cancellation errors
        }
      }
    };
  }, [pdfDoc, pageNumber, containerWidth, isNearViewport]);

  const targetWidth = Math.max(200, Math.floor(containerWidth));
  const estimatedHeight = Math.max(160, Math.round(targetWidth / aspectRatio));

  return (
    <div
      ref={wrapperRef}
      className="mx-auto flex flex-col items-center"
      style={{ width: `${targetWidth}px` }}
      data-pdf-page={pageNumber}
    >
      <div
        className="relative w-full rounded-lg overflow-hidden bg-white border border-slate-200/90 dark:border-white/10 shadow-sm flex items-center justify-center"
        style={{
          minHeight: isRendered ? undefined : `${estimatedHeight}px`,
        }}
      >
        {pageError ? (
          <div className="p-6 text-center text-xs text-rose-600 dark:text-rose-400">
            {pageError}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="block max-w-full h-auto select-none"
            aria-label={`PDF page ${pageNumber} of ${totalPages}`}
          />
        )}

        {!isRendered && !pageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 pointer-events-none">
            <Loader2 className="w-5 h-5 text-violet-600 animate-spin" />
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <span className="mt-1.5 text-[10px] font-mono font-semibold text-slate-400 dark:text-slate-500 tabular-nums">
          Page {pageNumber} of {totalPages}
        </span>
      )}
    </div>
  );
}

export default function PdfViewer({
  source,
  fileName,
  onResolvedUrl,
  onPageCountChange,
}: PdfViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const onResolvedUrlRef = useRef(onResolvedUrl);
  const onPageCountChangeRef = useRef(onPageCountChange);
  onResolvedUrlRef.current = onResolvedUrl;
  onPageCountChangeRef.current = onPageCountChange;

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<number>(8.5 / 11);
  const [containerWidth, setContainerWidth] = useState<number>(540);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  // Measure available width inside the modal viewer container
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setScrollRoot(el);

    const updateWidth = () => {
      // Subtract horizontal padding (px-4 => 32px) and small scrollbar buffer
      const available = Math.max(240, el.clientWidth - 40);
      setContainerWidth(available);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load PDF document and manage PDF.js + Blob URL lifecycle
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    let createdObjectUrl: string | null = null;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let activeDoc: pdfjsLib.PDFDocumentProxy | null = null;

    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setNumPages(0);
    onPageCountChangeRef.current?.(null);

    const loadPdf = async () => {
      try {
        const trimmed = (source || "").trim();
        if (!trimmed) {
          throw new Error("No PDF content available to preview.");
        }

        let documentInit: Parameters<typeof pdfjsLib.getDocument>[0];

        if (trimmed.startsWith("data:")) {
          const bytes = decodeDataUrlToBytes(trimmed);
          const blob = new Blob([bytes], { type: "application/pdf" });
          createdObjectUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            onResolvedUrlRef.current?.(createdObjectUrl);
          }
          documentInit = { data: new Uint8Array(bytes) };
        } else if (trimmed.startsWith("blob:")) {
          if (!cancelled) {
            onResolvedUrlRef.current?.(trimmed);
          }
          const response = await fetch(trimmed, { signal: abortController.signal });
          if (!response.ok) {
            throw new Error(`Failed to read PDF data (HTTP ${response.status}).`);
          }
          const buffer = await response.arrayBuffer();
          documentInit = { data: new Uint8Array(buffer) };
        } else if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
          const isInternalApi = trimmed.startsWith("/api/");
          if (!cancelled && !isInternalApi) {
            onResolvedUrlRef.current?.(trimmed);
          }
          try {
            const response = isInternalApi
              ? await authFetch(trimmed, { signal: abortController.signal })
              : await fetch(trimmed, { signal: abortController.signal });
            if (!response.ok) {
              throw new Error(`Unable to fetch PDF from storage (HTTP ${response.status}).`);
            }
            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const blob = new Blob([bytes], { type: "application/pdf" });
            createdObjectUrl = URL.createObjectURL(blob);
            if (!cancelled) {
              onResolvedUrlRef.current?.(createdObjectUrl);
            }
            documentInit = { data: new Uint8Array(bytes) };
          } catch (fetchErr: any) {
            if (fetchErr?.name === "AbortError" || cancelled) {
              return;
            }
            if (isInternalApi) {
              throw fetchErr;
            }
            // Fallback to letting PDF.js load the remote URL directly
            documentInit = { url: trimmed, withCredentials: false };
          }
        } else {
          throw new Error(
            "This document does not contain valid binary PDF data for inline rendering."
          );
        }

        if (cancelled) return;

        loadingTask = pdfjsLib.getDocument(documentInit);
        const doc = await loadingTask.promise;

        if (cancelled) {
          await doc.cleanup().catch(() => {});
          await loadingTask.destroy().catch(() => {});
          return;
        }

        activeDoc = doc;

        try {
          const firstPage = await doc.getPage(1);
          const vp = firstPage.getViewport({ scale: 1 });
          if (!cancelled && vp.width > 0 && vp.height > 0) {
            setDefaultAspectRatio(vp.width / vp.height);
          }
          firstPage.cleanup();
        } catch {
          // Keep default aspect ratio
        }

        if (cancelled) {
          await doc.cleanup().catch(() => {});
          await loadingTask.destroy().catch(() => {});
          activeDoc = null;
          return;
        }

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        onPageCountChangeRef.current?.(doc.numPages);
        setLoading(false);
      } catch (err: any) {
        if (cancelled || err?.name === "AbortError") {
          return;
        }
        console.error("PDF.js preview error:", err);

        let message = "Unable to render this PDF inline.";
        if (err?.name === "PasswordException") {
          message = "This PDF is password-protected and cannot be previewed inline.";
        } else if (err?.name === "InvalidPDFException") {
          message = "This file is not a valid or supported PDF document.";
        } else if (err?.message) {
          message = err.message;
        }

        if (!cancelled) {
          setError(message);
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      abortController.abort();
      if (activeDoc) {
        activeDoc.cleanup().catch(() => {});
      }
      if (loadingTask) {
        loadingTask.destroy().catch(() => {});
      }
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
      onResolvedUrlRef.current?.(null);
      onPageCountChangeRef.current?.(null);
    };
  }, [source]);

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex-1 w-full overflow-y-auto overflow-x-hidden px-4 pt-4 pb-16 space-y-4 select-none"
      id="feynman-pdf-viewer"
      aria-label={`PDF preview for ${fileName}`}
    >
      {loading && (
        <div
          className="h-full min-h-[260px] flex flex-col items-center justify-center space-y-3 text-center"
          id="feynman-pdf-loading"
        >
          <Loader2 className="w-7 h-7 text-violet-600 dark:text-violet-400 animate-spin" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Rendering PDF pages...
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Preparing {fileName}
            </p>
          </div>
        </div>
      )}

      {!loading && error && (
        <div
          className="h-full min-h-[260px] flex flex-col items-center justify-center text-center px-6 space-y-3"
          id="feynman-pdf-error"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Unable to preview PDF inline
            </h5>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {error}
            </p>
          </div>
        </div>
      )}

      {!loading && !error && pdfDoc && numPages > 0 && (
        <div className="flex flex-col items-center space-y-4">
          {Array.from({ length: numPages }, (_, index) => (
            <div
              key={`${source.length}-${source.slice(-16)}-${index + 1}`}
              className="w-full flex justify-center"
            >
              <PdfPageCanvas
                pdfDoc={pdfDoc}
                pageNumber={index + 1}
                totalPages={numPages}
                containerWidth={containerWidth}
                defaultAspectRatio={defaultAspectRatio}
                scrollRoot={scrollRoot}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
