"""两种来源共用元数据、事务和固定版本读取。"""

import asyncio
import json

import pytest

from solvemate_local.material_converter import MaterialError
from solvemate_local.materials import Materials
from solvemate_local.user_data import UserData


@pytest.fixture
def library(tmp_path):
    user = UserData(tmp_path)
    materials = Materials(tmp_path / "uploads", user=user)
    yield materials
    asyncio.run(materials.close())
    user.close()


def test_community_uses_same_edits_and_version_reader(library):
    ident = "calculus:textbooks:B001"
    item = library.get(ident)
    version = item["currentVersion"]
    item = library.rename(ident, "自己的标题", item["revision"])
    item = library.assign_course(ident, None, item["revision"])
    assert item["title"] == "自己的标题"
    assert item["subjectId"] is None
    assert library.page(ident, version, 1)["text"]
    item = library.delete(ident, item["revision"])
    assert item["deletedAt"] is not None
    assert library.page(ident, version, 1)["text"]
    assert library.user.db.execute("SELECT count(*) FROM materials").fetchone()[0] == 4


def test_conflict_does_not_overwrite_name_or_move(library):
    item = library.get("calculus:textbooks:B001")
    changed = library.rename(item["id"], "新版名字", item["revision"])
    with pytest.raises(MaterialError, match="已更新"):
        library.assign_course(item["id"], None, item["revision"])
    assert library.get(item["id"])["title"] == changed["title"]
    assert library.get(item["id"])["subjectId"] == "calculus"


def test_upload_metadata_migrates_once_and_file_is_preserved(tmp_path):
    ident, version = "a" * 36, "b" * 64
    folder = tmp_path / "uploads" / ident / version
    folder.mkdir(parents=True)
    original = folder / "original.pdf"
    original.write_bytes(b"original bytes")
    old = {
        "id": ident,
        "title": "上传资料",
        "courseId": None,
        "source": "personal",
        "currentVersion": version,
        "revision": 2,
        "createdAt": 1,
        "updatedAt": 2,
        "version": {
            "contentVersion": version,
            "mediaType": "application/pdf",
            "originalAssetId": "original.pdf",
            "readerAssetId": "original.pdf",
            "filename": "lesson.pdf",
            "sizeBytes": 14,
            "sha256": version,
            "pageCount": 1,
            "status": "ready",
            "error": None,
            "processor": None,
            "processorVersion": None,
        },
    }
    (folder.parent / "record.json").write_text(json.dumps(old), encoding="utf-8")
    user = UserData(tmp_path)
    first = Materials(tmp_path / "uploads", user=user)
    record = first.get(ident)
    assert record["id"] == ident
    assert record["subjectId"] is None
    first.rename(ident, "统一记录", record["revision"])
    second = Materials(tmp_path / "uploads", user=user)
    assert second.get(ident)["title"] == "统一记录"
    assert original.read_bytes() == b"original bytes"
    assert (
        json.loads((folder.parent / "record.json").read_text(encoding="utf-8"))["title"]
        == "上传资料"
    )
    assert list((tmp_path / "backups").glob("materials-*.sqlite3"))
    user.close()


def test_failed_transaction_rolls_back_all_material_edits(library):
    item = library.get("calculus:textbooks:B001")
    with pytest.raises(RuntimeError), library.repository.transaction():
        library.rename(item["id"], "不应保存", item["revision"])
        raise RuntimeError("failure")
    assert library.get(item["id"])["title"] == item["title"]


def test_new_version_preserves_local_title_subject_and_sibling(library):
    from copy import deepcopy

    original = library.get("calculus:textbooks:B001")
    sibling = library.get("calculus:questions")
    renamed = library.rename(original["id"], "我的高数", original["revision"])
    moved = library.assign_course(original["id"], None, renamed["revision"])
    new = deepcopy(moved["version"])
    new["contentVersion"] = "next-release"
    with library.repository.transaction():
        library.repository.db.execute(
            "INSERT INTO material_versions VALUES (?,?,?)",
            (original["id"], new["contentVersion"], json.dumps(new)),
        )
    updated = library.activate(original["id"], new["contentVersion"], moved["revision"])
    assert updated["title"] == "我的高数" and updated["subjectId"] is None
    assert library.get(sibling["id"]) == sibling
    assert library.page(original["id"], original["currentVersion"], 1)["text"]
    assert library.page(updated["id"], updated["currentVersion"], 1)["text"]


def test_question_location_uses_same_reader_and_fixed_version(library):
    from solvemate_local.models import ReadingReference

    item = library.get("calculus:questions")
    questions = library.questions(item["id"], item["currentVersion"])
    location = {
        "materialId": item["id"],
        "contentVersion": item["currentVersion"],
        "questionId": questions[0]["id"],
    }
    reference = ReadingReference(
        title=item["title"],
        content=questions[0]["question"],
        selection=None,
        material=location,
        quoteKind="page",
    )
    library.validate_reference(reference)
    library.delete(item["id"], item["revision"])
    library.validate_reference(reference)
    with pytest.raises(MaterialError, match="不存在"):
        library.validate_reference(
            reference.model_copy(
                update={"material": {**location, "questionId": "missing"}}
            )
        )


def test_subject_deletion_updates_both_sources_in_same_transaction(library):
    from test_user_data import data

    item = library.get("calculus:textbooks:B001")
    upload = {**item, "id": "upload-id", "source": "personal"}
    upload.pop("publisher", None)
    with library.repository.transaction():
        library.repository.put(upload)
    value = data()
    value["subjects"] = [
        {"id": "calculus", "title": "高数", "deleted": True, "materialsDeleted": True}
    ]
    library.user.save(value, 0)
    assert library.get(item["id"])["deletedAt"] is not None
    assert library.get(upload["id"])["deletedAt"] is not None
    assert library.page(upload["id"], item["currentVersion"], 1)["text"]


def test_location_conversion_preserves_references_and_reader_state():
    from solvemate_local.material_locations import unify_locations

    selection = {
        "courseId": "calculus",
        "version": "example-1",
        "kind": "textbooks",
        "itemId": "B001",
        "pageNumber": 3,
    }
    state = {
        "selection": selection,
        "materialSelection": None,
        "conversations": [
            {
                "selection": selection,
                "material": None,
                "messages": [
                    {
                        "reference": {
                            "selection": selection,
                            "content": "原文",
                            "title": "原名称",
                        }
                    }
                ],
            }
        ],
        "readingProgress": {
            "positions": {
                'content:["calculus","example-1","textbooks","B001",3]': {
                    "scroll": {"top": 99, "left": 8},
                    "answerVisible": False,
                }
            },
            "documents": {
                'content:["calculus","example-1","textbooks","B001"]': {
                    "zoom": 1.5,
                    "location": selection,
                }
            },
        },
    }
    converted = unify_locations(state)
    target = {
        "materialId": "calculus:textbooks:B001",
        "contentVersion": "example-1",
        "pageNumber": 3,
    }
    assert converted["materialSelection"] == target
    assert converted["conversations"][0]["material"] == target
    assert converted["conversations"][0]["messages"][0]["reference"] == {
        "selection": None,
        "material": target,
        "quoteKind": "page",
        "content": "原文",
        "title": "原名称",
    }
    assert (
        converted["readingProgress"]["positions"][
            "calculus:textbooks:B001/example-1/3"
        ]["scroll"]["top"]
        == 99
    )
    assert (
        converted["readingProgress"]["documents"][
            'material:["calculus:textbooks:B001","example-1"]'
        ]["location"]
        == target
    )
    assert state["materialSelection"] is None
    assert unify_locations(converted) == converted


def test_version_file_paths_cannot_escape_the_material_directory(library):
    item = library.get("calculus:textbooks:B001")
    item["version"]["readerAssetId"] = "../../../../app.sqlite3"
    with pytest.raises(MaterialError, match="路径无效"):
        library.folder(item)


def test_storage_paths_from_windows_use_the_same_relative_directory(library):
    item = library.get("calculus:textbooks:B001")
    expected = library.folder(item)
    item["version"]["storagePath"] = item["version"]["storagePath"].replace("/", "\\")
    assert library.folder(item) == expected
