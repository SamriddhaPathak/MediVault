/**
 * Report categories are stored as fixed uppercase enum values
 * (LABORATORY, PRESCRIPTION, RADIOLOGY, IMAGING, VACCINATION, OTHER),
 * appropriate for the database and API, but every page that displayed one
 * printed it exactly like that ("LABORATORY · 14 Mar 2026"). Centralizing
 * the display label here means Records, Dashboard, Exports and Record
 * Detail render the same friendly text, and any label change happens once.
 */
const CATEGORY_LABELS: Record<string, string> = {
  LABORATORY: "Laboratory",
  PRESCRIPTION: "Prescription",
  RADIOLOGY: "Radiology",
  IMAGING: "Imaging",
  VACCINATION: "Vaccination",
  OTHER: "Other",
};

export function formatCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// A distinct accent per category, used for the dashboard's category
// breakdown bars. Chosen as tints/shades of the existing brand ramp plus
// two complementary hues already used elsewhere in the app (amber for
// attention, slate for a neutral "other") rather than introducing a new
// palette.
export const CATEGORY_COLORS: Record<string, string> = {
  LABORATORY: "#17856a",
  PRESCRIPTION: "#43c19c",
  RADIOLOGY: "#2d6f8e",
  IMAGING: "#7a5fc7",
  VACCINATION: "#d97706",
  OTHER: "#64748b",
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.OTHER;
}
