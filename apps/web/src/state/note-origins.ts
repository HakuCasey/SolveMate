import type { LearningLocation, Note } from "@solvemate/contracts";
import { locationForOrigin } from "@solvemate/contracts";

export function sourceForNote(note: Note): LearningLocation | null {
  const first = note.origins.find((origin) => origin.kind !== "conversation");
  return first ? locationForOrigin(first) : null;
}
