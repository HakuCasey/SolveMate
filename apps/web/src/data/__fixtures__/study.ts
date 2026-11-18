import type { Note } from "@solvemate/contracts";
import { createInitialData } from "../catalog";
import { migrateAiMetadata } from "../migrate-ai-metadata";
import presets from "../seed-data.json";
import records from "./learning-records.json";

export function createStudyFixture() {
  const data = createInitialData();
  const history = migrateAiMetadata({
    ...data,
    schemaVersion: 1,
    robots: presets.robots,
    conversations: records.conversations,
  });
  for (const session of history.conversations) {
    if (session.selection) session.selection.version = data.selection.version;
  }
  data.conversations = history.conversations;
  data.noteLibrary!.notebooks.unshift(
    ...records.notebooks.map((item) => ({ ...item, revision: 1 })),
  );
  data.noteLibrary!.notes = structuredClone(records.notes) as Note[];
  return data;
}
