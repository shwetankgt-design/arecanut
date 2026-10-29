export interface CatalogItem {
  id: number;
  code: string;
  name: string;
  item_type: "report" | "dashboard";
  category: string;
  description?: string | null;
  route?: string | null;
  component: string;
  status: "active" | "inactive";
  display_order: number;
  registered: boolean;
  created_at?: string;
  assigned_users?: number;
}

export const TYPE_LABEL: Record<string, string> = { report: "Report", dashboard: "Dashboard" };
