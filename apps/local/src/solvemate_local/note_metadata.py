"""将旧笔记转换为统一来源集合；不更改正文、编号、标签或其他应用记录。"""

import json
from copy import deepcopy

from .metadata import MAX_NOTE_TITLE_LENGTH, validate_metadata

LEGACY_FIELDS = {"courseId", "questionId", "summary", "source", "excerpt"}


def reading_origins(source, excerpt=None):
    if source:
        validate_metadata(
            "MaterialLocation" if "materialId" in source else "ReadingSelection", source
        )
    if excerpt:
        validate_metadata("ReadingReference", excerpt)
    if excerpt and excerpt.get("message"):
        return [
            *reading_origins(source),
            {"kind": "conversation", **deepcopy(excerpt["message"])},
        ]
    cited = (excerpt or {}).get("material") or (excerpt or {}).get("selection")
    if source and cited and reading_origins(source) != reading_origins(cited):
        return [*reading_origins(source), *reading_origins(cited, excerpt)]
    location = source or cited
    if not location:
        return []
    if "materialId" in location:
        return [
            {
                "kind": "document",
                "materialId": location["materialId"],
                "version": location["contentVersion"],
                "pageNumber": location["pageNumber"],
            }
        ]
    version = location.get("version", "example-1")
    if location["kind"] == "questions":
        return [
            {
                "kind": "question",
                "materialId": f"{location['courseId']}:questions",
                "version": version,
                "questionId": location["itemId"],
            }
        ]
    return [
        {
            "kind": "document",
            "materialId": f"{location['courseId']}:textbooks:{location['itemId']}",
            "version": version,
            "pageNumber": location["pageNumber"],
        }
    ]


def migrate_note_metadata(value):
    if not isinstance(value, dict):
        raise TypeError("Saved application records are not an object.")
    library = value.get("noteLibrary")
    if library is None:
        return value
    if (
        not isinstance(library, dict)
        or not isinstance(library.get("notes"), list)
        or any(not isinstance(note, dict) for note in library["notes"])
    ):
        raise ValueError("Saved notes are not a valid collection.")
    notes = []
    changed = False
    for note in library["notes"]:
        if (
            "createdAt" in note
            and "updatedAt" in note
            and isinstance(note.get("origins"), list)
            and all(
                isinstance(item, dict) and "kind" in item and "quote" not in item
                for item in note["origins"]
            )
            and not LEGACY_FIELDS.intersection(note)
            and isinstance(note.get("title"), str)
            and len(note["title"]) <= MAX_NOTE_TITLE_LENGTH
        ):
            notes.append(note)
            continue
        changed = True
        origins = []
        for item in note.get("origins", []):
            origins.extend(
                [
                    {
                        key: deepcopy(value)
                        for key, value in item.items()
                        if key != "quote"
                    }
                ]
                if "kind" in item
                else reading_origins(item.get("source"), item.get("excerpt"))
            )
        if note.get("source") or note.get("excerpt"):
            origins.extend(reading_origins(note.get("source"), note.get("excerpt")))
        elif "source" not in note and note.get("courseId") and note.get("questionId"):
            origins.extend(
                reading_origins(
                    {
                        "courseId": note["courseId"],
                        "kind": "questions",
                        "itemId": note["questionId"],
                        "version": "example-1",
                    }
                )
            )
        unique, seen = [], set()
        for origin in origins:
            key = json.dumps(origin, sort_keys=True, ensure_ascii=False)
            if key not in seen:
                seen.add(key)
                unique.append(origin)
        notes.append(
            {
                **{key: item for key, item in note.items() if key not in LEGACY_FIELDS},
                "title": note["title"][:MAX_NOTE_TITLE_LENGTH]
                if isinstance(note.get("title"), str)
                else note.get("title"),
                "createdAt": note.get("createdAt"),
                "updatedAt": note.get("updatedAt"),
                "origins": unique,
            }
        )
    return {**value, "noteLibrary": {**library, "notes": notes}} if changed else value
