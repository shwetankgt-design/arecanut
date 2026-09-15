import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { UploadCloud, Download, AlertCircle, CheckCircle2 } from "lucide-react";
import { parseBoundaryWorkbook, buildSampleTemplateWorkbook } from "../../lib/excelBoundary";
import type { PlotBoundary } from "../../lib/plotBoundary";

interface Props {
  onParsed: (points: PlotBoundary) => void;
}

// Parsing logic (lib/excelBoundary.ts) is 100% shared with any future native
// screen — only the file-picking/download mechanics below are web-specific,
// per spec §5.2/§5.3. The Capacitor Android app runs this same <input> path
// (it's a WebView), so today there is no separate native branch to write.
export default function ExcelUploadTab({ onParsed }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setSuccessCount(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseBoundaryWorkbook(buffer);
      if (result.error || !result.points) {
        setError(result.error || "Could not parse this file.");
        return; // never touch existing boundary state on a failed parse
      }
      onParsed(result.points);
      setSuccessCount(result.points.length);
    } catch (e: any) {
      setError(e?.message || "Could not read this file.");
    }
  };

  const downloadTemplate = async () => {
    const wb = buildSampleTemplateWorkbook();
    if (Capacitor.getPlatform() === "web") {
      XLSX.writeFile(wb, "plot-boundary-template.xlsx");
      return;
    }
    // Native: no browser "download" — write to cache then hand off to the
    // system share sheet so the user can save it wherever they like.
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const { uri } = await Filesystem.writeFile({
      path: "plot-boundary-template.xlsx",
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ title: "Plot Boundary Template", url: uri });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-[var(--gt-text-muted)]">
        Upload a spreadsheet with "Latitude" and "Longitude" columns (.xlsx, .xls, or .csv) — at least 3 rows, in boundary order.
      </div>

      <div
        className="border-2 border-dashed border-[var(--gt-border)] rounded-xl p-8 flex flex-col items-center gap-2 text-center cursor-pointer hover:border-[var(--gt-purple-light)] transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <UploadCloud size={28} className="text-[var(--gt-purple)]" />
        <div className="text-sm font-medium">Tap to choose a file, or drag one here</div>
        <div className="text-xs text-[var(--gt-text-muted)]">.xlsx, .xls, .csv</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {successCount != null && !error && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2">
          <CheckCircle2 size={16} /> Loaded {successCount} boundary points from the file.
        </div>
      )}

      <button className="gt-btn-secondary flex items-center gap-1.5 w-fit" onClick={downloadTemplate}>
        <Download size={15} /> Download Sample Template
      </button>
    </div>
  );
}
