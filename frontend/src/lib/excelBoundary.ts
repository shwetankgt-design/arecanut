import * as XLSX from "xlsx";
import type { PlotBoundary } from "./plotBoundary";

export interface ParseResult {
  points?: PlotBoundary;
  error?: string;
}

/** Shared parsing logic (per spec §5.1) — identical regardless of how the raw
 * bytes were obtained (browser <input type=file> or a native file picker). */
export function parseBoundaryWorkbook(data: ArrayBuffer | string, isBase64 = false): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: isBase64 ? "base64" : "array" });
  } catch {
    return { error: "Could not read this file — is it a valid .xlsx, .xls, or .csv?" };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { error: "The file has no sheets." };

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  if (rows.length === 0) return { error: "The sheet is empty." };

  const header = rows[0].map((h) => String(h ?? ""));
  const latCol = header.findIndex((h) => /lat/i.test(h));
  const lngCol = header.findIndex((h) => /lon|lng/i.test(h));

  if (latCol === -1 || lngCol === -1) {
    return { error: "Couldn't find Latitude/Longitude columns — the header row must contain columns named like \"Latitude\" and \"Longitude\"." };
  }

  const points: PlotBoundary = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const lat = Number(row[latCol]);
    const lng = Number(row[lngCol]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
      points.push({ lat, lng });
    }
  }

  if (points.length < 3) {
    return { error: `Found ${points.length} valid coordinate row(s) — need at least 3 valid rows to form a boundary.` };
  }

  return { points };
}

/** Builds the downloadable sample template workbook (shared object; only how
 * it's delivered to the user differs — see ExcelUploadTab for the web/native split). */
export function buildSampleTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Latitude", "Longitude"],
    [13.9299, 75.5681],
    [13.9305, 75.5690],
    [13.9298, 75.5697],
    [13.9291, 75.5688],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Plot Boundary");
  return wb;
}
