import { supabase } from "@/integrations/supabase/client";

export interface DiaryData {
  isImportant: boolean;
  priority?: "HOT" | "HIGH" | "NORMAL";
  targetDate?: string;
  notes?: string;
  markedAt?: string;
}

const DIARY_PREFIX = "<!-- DIARY_DATA:";
const DIARY_SUFFIX = "-->";

/**
 * Checks if a lead's notes mark it as an Important Diary lead.
 */
export function isDiaryLead(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return notes.includes(DIARY_PREFIX) || notes.includes("[DIARY]") || notes.includes("[IMPORTANT]");
}

/**
 * Parses diary metadata from notes.
 */
export function parseDiaryData(notes: string | null | undefined): DiaryData | null {
  if (!notes) return null;
  
  const startIdx = notes.indexOf(DIARY_PREFIX);
  if (startIdx !== -1) {
    const endIdx = notes.indexOf(DIARY_SUFFIX, startIdx);
    if (endIdx !== -1) {
      try {
        const jsonStr = notes.substring(startIdx + DIARY_PREFIX.length, endIdx).trim();
        return JSON.parse(jsonStr) as DiaryData;
      } catch (e) {
        console.error("Failed to parse diary JSON", e);
      }
    }
  }

  // Fallback if tagged with plain text [DIARY]
  if (notes.includes("[DIARY]") || notes.includes("[IMPORTANT]")) {
    return {
      isImportant: true,
      priority: "HIGH",
      notes: "Marked as Important",
    };
  }

  return null;
}

/**
 * Appends or updates Diary metadata in lead notes without overwriting other notes.
 */
export function serializeDiaryData(existingNotes: string | null | undefined, data: DiaryData | null): string {
  let cleanNotes = (existingNotes || "").trim();

  // Strip existing diary comment
  const startIdx = cleanNotes.indexOf(DIARY_PREFIX);
  if (startIdx !== -1) {
    const endIdx = cleanNotes.indexOf(DIARY_SUFFIX, startIdx);
    if (endIdx !== -1) {
      cleanNotes = (
        cleanNotes.substring(0, startIdx) + 
        cleanNotes.substring(endIdx + DIARY_SUFFIX.length)
      ).trim();
    }
  }

  // Strip plain tags if any
  cleanNotes = cleanNotes.replace(/\[DIARY\]/g, "").replace(/\[IMPORTANT\]/g, "").trim();

  if (!data || !data.isImportant) {
    return cleanNotes;
  }

  const payload: DiaryData = {
    ...data,
    isImportant: true,
    markedAt: data.markedAt || new Date().toISOString(),
  };

  const diaryBlock = `${DIARY_PREFIX}${JSON.stringify(payload)}${DIARY_SUFFIX}`;
  return cleanNotes ? `${cleanNotes}\n\n${diaryBlock}` : diaryBlock;
}

/**
 * Saves or removes a lead from Diary in Supabase.
 */
export async function saveLeadDiary(
  leadId: string,
  existingNotes: string | null | undefined,
  diaryData: DiaryData | null
) {
  const updatedNotes = serializeDiaryData(existingNotes, diaryData);
  const { data, error } = await supabase
    .from("leads")
    .update({
      notes: updatedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .select("id, notes")
    .single();

  if (error) throw error;
  return data;
}
