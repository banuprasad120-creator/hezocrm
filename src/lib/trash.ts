export interface TrashData {
  isTrash: boolean;
  reason: string;
  trashedAt: string;
  trashedBy?: string;
  originalStatus?: string;
}

const TRASH_PREFIX = "<!-- TRASH_DATA:";
const TRASH_SUFFIX = "-->";

/**
 * Checks if a lead's notes or status indicates it is in the Trash / Out of Service bin.
 */
export function isTrashLead(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return (
    notes.includes(TRASH_PREFIX) ||
    notes.includes("[TRASH]") ||
    notes.includes("[OUT_OF_SERVICE]") ||
    notes.includes("Marked Out of Service")
  );
}

/**
 * Parses trash metadata from lead notes.
 */
export function parseTrashData(notes: string | null | undefined): TrashData | null {
  if (!notes) return null;

  const startIdx = notes.indexOf(TRASH_PREFIX);
  if (startIdx !== -1) {
    const endIdx = notes.indexOf(TRASH_SUFFIX, startIdx);
    if (endIdx !== -1) {
      try {
        const jsonStr = notes.substring(startIdx + TRASH_PREFIX.length, endIdx).trim();
        return JSON.parse(jsonStr) as TrashData;
      } catch (e) {
        console.error("Failed to parse trash JSON", e);
      }
    }
  }

  // Fallback if plain text marker exists
  if (
    notes.includes("[TRASH]") ||
    notes.includes("[OUT_OF_SERVICE]") ||
    notes.includes("Marked Out of Service")
  ) {
    return {
      isTrash: true,
      reason: "Out of Service / Invalid Number",
      trashedAt: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Serializes trash metadata into the lead notes.
 */
export function serializeTrashData(
  existingNotes: string | null | undefined,
  data: TrashData | null
): string {
  let cleanNotes = (existingNotes || "").trim();

  // Strip existing trash block
  const startIdx = cleanNotes.indexOf(TRASH_PREFIX);
  if (startIdx !== -1) {
    const endIdx = cleanNotes.indexOf(TRASH_SUFFIX, startIdx);
    if (endIdx !== -1) {
      cleanNotes = (
        cleanNotes.substring(0, startIdx) +
        cleanNotes.substring(endIdx + TRASH_SUFFIX.length)
      ).trim();
    }
  }

  // Strip plain markers
  cleanNotes = cleanNotes
    .replace(/\[TRASH\]/g, "")
    .replace(/\[OUT_OF_SERVICE\]/g, "")
    .replace(/Marked Out of Service \/ Deleted/g, "")
    .trim();

  if (!data || !data.isTrash) {
    return cleanNotes;
  }

  const payload: TrashData = {
    ...data,
    isTrash: true,
    trashedAt: data.trashedAt || new Date().toISOString(),
  };

  const trashBlock = `${TRASH_PREFIX}${JSON.stringify(payload)}${TRASH_SUFFIX}`;
  const userSummary = `🗑️ [TRASH / OUT OF SERVICE]: ${data.reason || "Invalid Number"}`;

  return cleanNotes
    ? `${cleanNotes}\n\n${trashBlock}\n${userSummary}`
    : `${trashBlock}\n${userSummary}`;
}
