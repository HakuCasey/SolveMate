"""导入原件、处理失败恢复与资料引用的接口验证，不调用真实模型。"""

import io
import json
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from test_service import HEADERS

from solvemate_local import material_converter, processes
from solvemate_local.main import create_app
from solvemate_local.material_converter import MaterialError
from solvemate_local.materials import Materials
from solvemate_local.models import ReadingReference, Teacher, TurnRequest
from solvemate_local.service import AiService


def pdf_bytes():
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            )
        }
    )
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 12 Tf 40 700 Td (int main\\(\\) { return 0; }) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(content)
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


def upload(client, value=None, filename="lesson.pdf"):
    return client.post(
        "/local-api/v1/materials",
        params={"filename": filename},
        content=value or pdf_bytes(),
        headers={"content-type": "application/octet-stream"},
    )


def finished(client, ident):
    for _ in range(200):
        record = next(
            item
            for item in client.get("/local-api/v1/materials").json()
            if item["id"] == ident
        )
        if record["version"]["status"] != "processing":
            return record
        time.sleep(0.01)
    pytest.fail("Material processing did not finish.")


def test_import_deduplicate_read_and_reopen(tmp_path):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        first = upload(client)
        assert first.status_code == 202, first.text
        record = finished(client, first.json()["id"])
        assert record["source"] == "personal"
        assert record["version"]["pageCount"] == 1
        assert record["version"]["status"] == "ready"
        assert upload(client, filename="renamed.pdf").json()["id"] == record["id"]
        path = f"/local-api/v1/materials/{record['id']}/{record['currentVersion']}"
        assert client.get(path + "/reader").content == pdf_bytes()
        assert (
            "int main() { return 0; }" in client.get(path + "/pages/1").json()["text"]
        )
        cached = app.state.materials.folder(record) / "text/1.json"
        cached.write_text("damaged cache", encoding="utf-8")
        assert "return 0" in client.get(path + "/pages/1").json()["text"]
        assert client.get(path + "/pages/2").status_code == 422
        assert (
            client.get(
                path.replace(record["currentVersion"], "0" * 64) + "/reader"
            ).status_code
            == 404
        )
        assert (
            client.get(
                path + "/reader", headers={"x-solvemate-client": "wrong"}
            ).status_code
            == 403
        )
    reopened = Materials(tmp_path / "materials")
    assert reopened.get(record["id"])["version"]["status"] == "ready"
    assert len(reopened.list()) == 1


def test_rename_move_delete_preserve_files_and_history_after_restart(tmp_path):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        original = finished(client, upload(client).json()["id"])
        base = f"/local-api/v1/materials/{original['id']}"
        renamed = client.patch(
            base + "/title",
            json={
                "title": "  C 语言课堂讲义  ",
                "expectedRevision": original["revision"],
            },
        )
        assert renamed.status_code == 200, renamed.text
        record = renamed.json()
        assert record["title"] == "C 语言课堂讲义"
        assert record["version"] == original["version"]
        assert record["currentVersion"] == original["currentVersion"]
        assert (
            client.patch(
                base + "/title",
                json={"title": "过期名称", "expectedRevision": original["revision"]},
            ).status_code
            == 409
        )
        for title in [" ", "line\nbreak", "nul\0value", "a" * 241]:
            assert (
                client.patch(
                    base + "/title",
                    json={"title": title, "expectedRevision": record["revision"]},
                ).status_code
                == 422
            )
        moved = client.patch(
            base + "/course",
            json={"courseId": "c-language", "expectedRevision": record["revision"]},
        ).json()
        assert moved["courseId"] == "c-language"
        deleted = client.request(
            "DELETE", base, json={"expectedRevision": moved["revision"]}
        )
        assert deleted.status_code == 200, deleted.text
        record = deleted.json()
        assert record["deletedAt"] > 0
        assert record["id"] == original["id"]
        assert (
            client.request(
                "DELETE", base, json={"expectedRevision": moved["revision"]}
            ).status_code
            == 409
        )
        assert (
            client.patch(
                base + "/course",
                json={"courseId": None, "expectedRevision": record["revision"]},
            ).status_code
            == 409
        )
        assert (
            client.patch(
                base + "/title",
                json={
                    "title": "不能恢复删除条目",
                    "expectedRevision": record["revision"],
                },
            ).status_code
            == 409
        )
        history = base + f"/{original['currentVersion']}"
        assert client.get(history + "/reader").content == pdf_bytes()
        assert "return 0" in client.get(history + "/pages/1").json()["text"]
        # 重新导入同一文件建立新条目，不能将原来删除的条目重新显示。
        replacement = upload(client).json()
        assert replacement["id"] != original["id"]
    reopened = Materials(tmp_path / "materials")
    record = reopened.get(original["id"])
    assert record["title"] == "C 语言课堂讲义" and record["deletedAt"] > 0
    assert reopened.reader_path(original["id"], original["currentVersion"])[1].is_file()


def test_processing_and_save_failure_do_not_overwrite_material_edits(
    tmp_path, monkeypatch
):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        original = finished(client, upload(client).json()["id"])
        materials = app.state.materials
        renamed = materials.rename(original["id"], "新名称", original["revision"])
        deleted = materials.delete(original["id"], renamed["revision"])
        materials.save_processing(original)
        latest = materials.get(original["id"])
        assert (
            latest["title"] == "新名称" and latest["deletedAt"] == deleted["deletedAt"]
        )
        active = finished(client, upload(client).json()["id"])

        def fail_replace(*args):
            raise OSError("Synthetic disk failure")

        monkeypatch.setattr("solvemate_local.materials.os.replace", fail_replace)
        with pytest.raises(OSError):
            materials.rename(active["id"], "未能保存", active["revision"])
        with pytest.raises(OSError):
            materials.delete(active["id"], active["revision"])
        latest = materials.get(active["id"])
        assert latest["title"] == active["title"]
        assert latest.get("deletedAt") is None


def test_invalid_input_keeps_original_and_size_limit_is_actual_bytes(
    tmp_path, monkeypatch
):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        assert upload(client, filename="file.exe").status_code == 422
        record = finished(client, upload(client, b"not a PDF").json()["id"])
        assert record["version"]["status"] == "failed"
        assert (
            app.state.materials.folder(record) / "original.pdf"
        ).read_bytes() == b"not a PDF"
        assert "原件已保留" in record["version"]["error"]
        monkeypatch.setattr("solvemate_local.materials.MAX_BYTES", 10)
        assert upload(client).status_code == 413
        assert not list((tmp_path / "materials").glob("upload-*"))
        assert (
            client.post(
                "/local-api/v1/materials?filename=x.pdf",
                content=b"a",
                headers={
                    "content-type": "application/octet-stream",
                    "origin": "https://other.example",
                },
            ).status_code
            == 403
        )


def test_converter_missing_retry_and_interrupted_processing(tmp_path, monkeypatch):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("ppt/presentation.xml", "<presentation/>")
    attempts = []

    async def convert(source, output):
        attempts.append(source)
        if len(attempts) == 1:
            raise MaterialError(
                "未找到 LibreOffice，请安装后重试。", "converter_missing"
            )
        result = output / "original.pdf"
        result.write_bytes(pdf_bytes())
        return result

    monkeypatch.setattr("solvemate_local.materials.convert_pptx", convert)
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        record = finished(
            client, upload(client, stream.getvalue(), "lesson.pptx").json()["id"]
        )
        assert record["version"]["status"] == "failed"
        assert "LibreOffice" in record["version"]["error"]
        retry = client.post(f"/local-api/v1/materials/{record['id']}/retry", json={})
        assert retry.status_code == 202
        record = finished(client, record["id"])
        assert record["version"]["readerAssetId"] == "reader.pdf"
        assert record["version"]["pageCount"] == 1
        reference = ReadingReference(
            title="课件",
            content="int main()",
            selection=None,
            material={
                "materialId": record["id"],
                "contentVersion": record["currentVersion"],
                "pageNumber": 1,
            },
            quoteKind="selection",
        )
        app.state.materials.validate_reference(reference)
        request = TurnRequest(
            id="test-turn",
            conversationId="test-session",
            userMessageId="message",
            text="为什么返回 0？",
            teacher=Teacher(id="teacher", name="教师", prompt="准确回答。"),
            reference=reference,
        )
        composed = AiService.compose(request, True)
        assert composed.startswith("为什么返回 0？")
        assert "第 1 页" in composed and "int main()" in composed
        bad = reference.model_copy(
            update={"material": {**reference.material, "pageNumber": 2}}
        )
        with pytest.raises(MaterialError):
            app.state.materials.validate_reference(bad)
    path = tmp_path / "materials" / record["id"] / "record.json"
    record["version"]["status"] = "processing"
    path.write_text(json.dumps(record), encoding="utf-8")
    recovered = Materials(tmp_path / "materials").get(record["id"])
    assert recovered["version"]["status"] == "failed"
    assert "中断" in recovered["version"]["error"]


@pytest.mark.parametrize(
    "platform,env,suffix",
    [
        ("darwin", {}, "/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        (
            "win32",
            {"PROGRAMFILES": "C:/Program Files"},
            "C:/Program Files/LibreOffice/program/soffice.exe",
        ),
    ],
)
def test_converter_discovery_is_cross_platform(monkeypatch, platform, env, suffix):
    monkeypatch.setattr(Path, "is_file", lambda self: self.as_posix() == suffix)
    assert material_converter.find_libreoffice(platform, env, lambda _: None) == suffix
    assert (
        material_converter.find_libreoffice(platform, env, lambda _: "custom/soffice")
        == "custom/soffice"
    )
    with pytest.raises(MaterialError, match="指定"):
        material_converter.find_libreoffice(
            platform, {"SOLVEMATE_LIBREOFFICE": "missing"}, lambda _: None
        )


def test_missing_reader_can_be_restored_by_importing_same_original(tmp_path):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        record = finished(client, upload(client).json()["id"])
        (app.state.materials.folder(record) / "original.pdf").unlink()
        assert upload(client).json()["id"] == record["id"]
        restored = finished(client, record["id"])
        assert restored["version"]["status"] == "ready"
        assert (
            app.state.materials.folder(restored) / "original.pdf"
        ).read_bytes() == pdf_bytes()
        broken = tmp_path / "materials" / "broken"
        broken.mkdir()
        (broken / "record.json").write_text("{}", encoding="utf-8")
        response = client.get("/local-api/v1/materials")
        assert len(response.json()) == 1
        assert response.headers["X-SolveMate-Material-Errors"] == "1"


def test_conversion_uses_own_profile_and_kills_only_its_process_group(
    tmp_path, monkeypatch
):
    import asyncio

    monkeypatch.setattr(material_converter, "find_libreoffice", lambda: "/safe/soffice")
    calls = []
    killed = []

    class Process:
        pid = 12345
        returncode = None

        async def wait(self):
            if killed:
                self.returncode = -9
                return -9
            await asyncio.sleep(1)

    async def start(*args, **kwargs):
        calls.append((args, kwargs))
        return Process()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", start)
    monkeypatch.setattr(
        processes.os, "killpg", lambda pid, sig: killed.append(pid), raising=False
    )
    monkeypatch.setattr(material_converter.sys, "platform", "linux")
    with pytest.raises(MaterialError, match="超过"):
        asyncio.run(
            material_converter.convert_pptx(
                tmp_path / "unsafe name.pptx", tmp_path, timeout=0.001
            )
        )
    assert killed == [12345]
    assert calls[0][0][-1] == str(tmp_path / "unsafe name.pptx")
    assert any(value.startswith("-env:UserInstallation=file:") for value in calls[0][0])
    assert calls[0][1]["start_new_session"]


def test_windows_conversion_timeout_terminates_only_its_process_tree(
    tmp_path, monkeypatch
):
    import asyncio

    monkeypatch.setattr(
        material_converter,
        "find_libreoffice",
        lambda: "C:/Program Files/LibreOffice/program/soffice.com",
    )
    monkeypatch.setattr(material_converter.sys, "platform", "win32")
    calls = []

    class Process:
        pid = 54321
        returncode = None

        async def wait(self):
            if len(calls) > 1:
                self.returncode = -1
                return -1
            await asyncio.sleep(1)

    class Killer:
        async def wait(self):
            return 0

    async def start(*args, **kwargs):
        calls.append((args, kwargs))
        return Killer() if args[0] == "taskkill" else Process()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", start)
    with pytest.raises(MaterialError, match="超过"):
        asyncio.run(
            material_converter.convert_pptx(
                tmp_path / "lesson.pptx", tmp_path, timeout=0.001
            )
        )
    assert calls[0][1]["creationflags"] == 0x00000200
    assert "start_new_session" not in calls[0][1]
    assert calls[1][0] == ("taskkill", "/PID", "54321", "/T", "/F")


def test_failed_result_write_is_visible_and_does_not_lose_original(
    tmp_path, monkeypatch
):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        service = app.state.materials
        original = service.save

        def save(record):
            if record["version"]["status"] == "ready":
                raise OSError("disk full")
            return original(record)

        monkeypatch.setattr(service, "save", save)
        record = finished(client, upload(client).json()["id"])
        assert record["version"]["status"] == "failed"
        assert "处理结果未能保存" in record["version"]["error"]
        assert (service.folder(record) / "original.pdf").read_bytes() == pdf_bytes()
        monkeypatch.setattr(service, "save", original)
        client.post(f"/local-api/v1/materials/{record['id']}/retry", json={})
        assert finished(client, record["id"])["version"]["status"] == "ready"


def test_same_file_can_belong_to_different_courses_without_moving_existing_record(
    tmp_path,
):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:

        def put(course):
            return client.post(
                "/local-api/v1/materials",
                params={"filename": "course.pdf", "courseId": course},
                content=pdf_bytes(),
                headers={"content-type": "application/octet-stream"},
            ).json()

        c = put("c-language")
        math = put("calculus")
        assert c["id"] != math["id"]
        assert put("c-language")["id"] == c["id"]
        assert app.state.materials.get(c["id"])["courseId"] == "c-language"
        assert app.state.materials.get(math["id"])["courseId"] == "calculus"


def test_assignment_keeps_original_identity_and_checks_revision(tmp_path):
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        record = finished(client, upload(client).json()["id"])
        path = f"/local-api/v1/materials/{record['id']}/course"
        response = client.patch(
            path,
            json={"courseId": "c-language", "expectedRevision": record["revision"]},
        )
        assert response.status_code == 200
        changed = response.json()
        assert (
            changed["id"] == record["id"]
            and changed["currentVersion"] == record["currentVersion"]
        )
        assert (
            changed["courseId"] == "c-language"
            and changed["revision"] == record["revision"] + 1
        )
        assert (
            client.patch(
                path,
                json={"courseId": "calculus", "expectedRevision": record["revision"]},
            ).status_code
            == 409
        )
        assert (
            client.patch(
                path,
                json={
                    "courseId": "../invalid",
                    "expectedRevision": changed["revision"],
                },
            ).status_code
            == 422
        )
        assert (
            client.patch(
                path, json={"courseId": None, "expectedRevision": changed["revision"]}
            ).json()["courseId"]
            is None
        )


def test_assignment_during_processing_is_preserved(tmp_path, monkeypatch):
    import asyncio

    entered, release = asyncio.Event(), asyncio.Event()

    async def convert(source, output):
        entered.set()
        await release.wait()
        result = output / "original.pdf"
        result.write_bytes(pdf_bytes())
        return result

    monkeypatch.setattr("solvemate_local.materials.convert_pptx", convert)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("ppt/presentation.xml", "<presentation/>")
    app = create_app(tmp_path / "ai", materials_directory=tmp_path / "materials")
    with TestClient(app, headers=HEADERS) as client:
        record = upload(client, stream.getvalue(), "lesson.pptx").json()
        client.portal.call(entered.wait)
        response = client.patch(
            f"/local-api/v1/materials/{record['id']}/course",
            json={"courseId": "c-language", "expectedRevision": record["revision"]},
        )
        assert response.status_code == 200
        client.portal.call(release.set)
        result = finished(client, record["id"])
        assert (
            result["version"]["status"] == "ready"
            and result["courseId"] == "c-language"
        )
