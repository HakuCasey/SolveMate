"""本机错误按日期保存。诊断仅在用户请求时读取数据库。"""

import json
import logging
import re
import sqlite3
from collections import deque
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, Request

from .user_data import UserDataError, validate_data

router = APIRouter(prefix="/local-api/v1/user")
LOG_NAME = re.compile(r"error_(\d{4}-\d{2}-\d{2})\.log(?:\.1)?")
MAX_BYTES = 256 * 1024
RETENTION_DAYS = 14


class DiagnosticLog:
    def __init__(self, root):
        self.directory = Path(root) / "logs"
        self.lock = Lock()
        self.cleaned = None
        self.write_failed = False

    def _files(self, today):
        cutoff = (today - timedelta(days=RETENTION_DAYS - 1)).isoformat()
        paths = []
        if self.directory.is_symlink():
            raise OSError("Unexpected log directory symlink")
        if self.directory.is_dir():
            for path in self.directory.iterdir():
                match = LOG_NAME.fullmatch(path.name)
                if not match or path.is_symlink() or not path.is_file():
                    continue
                if match[1] < cutoff:
                    path.unlink(missing_ok=True)
                else:
                    paths.append(path)
        self.cleaned = today
        return sorted(
            paths, key=lambda p: (p.name.removesuffix(".1"), p.suffix != ".1")
        )

    def record(self, action, code, **fields):
        now = datetime.now().astimezone()
        entry = {
            "time": now.isoformat(timespec="milliseconds"),
            "action": action,
            "code": code,
            **fields,
        }
        line = (json.dumps(entry, separators=(",", ":")) + "\n").encode()
        with self.lock:
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
                if self.cleaned != now.date():
                    self._files(now.date())
                path = self.directory / f"error_{now.date()}.log"
                if self.directory.is_symlink() or path.is_symlink():
                    raise OSError("Unexpected log symlink")
                if path.exists() and path.stat().st_size + len(line) > MAX_BYTES:
                    path.replace(path.with_suffix(".log.1"))
                with path.open("ab") as stream:
                    stream.write(line)
                self.write_failed = False
            except OSError:
                if not self.write_failed:
                    logging.getLogger(__name__).warning(
                        "Cannot write local diagnostic log."
                    )
                self.write_failed = True

    def recent(self):
        with self.lock:
            rows = []
            try:
                # 从最新文件开始，只读取导出所需的最近 50 条。
                for path in reversed(self._files(date.today())):
                    with path.open(encoding="utf-8") as stream:
                        for line in reversed(deque(stream, maxlen=50)):
                            try:
                                rows.append(json.loads(line))
                            except ValueError:
                                continue
                            if len(rows) == 50:
                                return rows, not self.write_failed
            except (OSError, UnicodeError):
                return rows, False
            return rows, not self.write_failed


def check_database(path, learning):
    try:
        with closing(
            sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)
        ) as db:
            if db.execute("PRAGMA quick_check(1)").fetchone() != ("ok",):
                return "integrity_error"
            if learning:
                row = db.execute("SELECT value FROM state WHERE id=1").fetchone()
                if row:
                    value = json.loads(row[0])
                    if not isinstance(value, dict):
                        return "invalid_record"
                    validate_data(value)
                if db.execute(
                    "SELECT 1 FROM study_days WHERE typeof(milliseconds) != 'integer' OR milliseconds NOT BETWEEN 0 AND 86400000 LIMIT 1"
                ).fetchone():
                    return "study_duration_exceeded"
            else:
                db.execute("SELECT id FROM turns LIMIT 1").fetchone()
            return "ok"
    except (ValueError, UserDataError):
        return "invalid_record"
    except (sqlite3.Error, OSError):
        return "read_failed"


@router.get("/diagnostics")
def diagnostics(request: Request):
    state = request.app.state
    logs, logs_available = state.diagnostics.recent()
    return {
        "learningDatabase": check_database(state.user.root / "app.sqlite3", True),
        "aiDatabase": check_database(state.ai.store.directory / "state.sqlite3", False),
        "logsAvailable": logs_available,
        "errors": logs,
    }
