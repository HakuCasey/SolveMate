import json
import sqlite3
from pathlib import Path
from time import time

from .metadata import (
    LEGACY_CONNECTIONS,
    normalized_detection,
    public_turn,
    upgrade_turn,
    validate_metadata,
)


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.directory = directory
        self.db = sqlite3.connect(directory / "state.sqlite3")
        self.db.row_factory = sqlite3.Row
        if self.db.execute("PRAGMA user_version").fetchone()[0] > 4:
            self.db.close()
            raise ValueError("AI database has an unsupported schema version.")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS bindings (
                conversation_id TEXT PRIMARY KEY, external_id TEXT NOT NULL,
                executable TEXT NOT NULL, workspace TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS turns (
                id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS turns_conversation ON turns(conversation_id);
            CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS deleted_connections (
                id TEXT PRIMARY KEY, revision INTEGER NOT NULL, deleted_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS probes (id TEXT PRIMARY KEY, session_id TEXT);
        """)
        columns = {
            row["name"] for row in self.db.execute("PRAGMA table_info(bindings)")
        }
        if "harness_home" not in columns:
            self.db.execute(
                "ALTER TABLE bindings ADD COLUMN harness_home TEXT NOT NULL DEFAULT ''"
            )
            self.db.commit()
        if "connection_id" not in columns:
            self.db.execute(
                "ALTER TABLE bindings ADD COLUMN connection_id TEXT NOT NULL DEFAULT 'deepseek-local'"
            )
        try:
            self._migrate_metadata()
            self._migrate_connections()
            self._migrate_default_model()
        except BaseException:
            self.db.close()
            raise
        for name, definition in [
            ("protocol", "TEXT"),
            ("revision", "INTEGER NOT NULL DEFAULT 1"),
            ("state", "TEXT NOT NULL DEFAULT 'bound'"),
        ]:
            if name not in {
                row["name"] for row in self.db.execute("PRAGMA table_info(bindings)")
            }:
                self.db.execute(f"ALTER TABLE bindings ADD COLUMN {name} {definition}")
        with self.db:
            self.db.execute(
                "UPDATE bindings SET protocol=CASE WHEN connection_id='codex-local' THEN 'codex-app-server' ELSE 'acp' END WHERE protocol IS NULL"
            )
            self.db.execute(
                "UPDATE bindings SET state='uncertain' WHERE external_id='' AND state='bound'"
            )
        self._migrate_session_bindings()
        # 进程中断后不能把旧请求当作仍在生成，也不能自动重复调用模型。
        for row in self.db.execute("SELECT id, value FROM turns").fetchall():
            turn = json.loads(row["value"])
            if turn["status"] == "running":
                turn.update(
                    status="interrupted",
                    phase="finished",
                    error="本机服务在生成期间停止。已收到的内容仍保留，请确认后重新提问。",
                    permissions=[],
                    completedAt=int(time() * 1000),
                )
                self.save_turn(turn)

    def close(self):
        self.db.close()

    def _migrate_metadata(self):
        row = self.db.execute("SELECT value FROM config WHERE id=1").fetchone()
        old = json.loads(row[0]) if row else None
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        if version > 4:
            raise ValueError("AI database has an unsupported schema version.")
        if version >= 2:
            return
        with self.db:
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS metadata_backups (version INTEGER PRIMARY KEY, value TEXT NOT NULL)"
            )
            backup = {
                table: [
                    dict(item) for item in self.db.execute(f"SELECT * FROM {table}")
                ]
                for table in ["config", "connections", "bindings", "turns", "probes"]
            }
            self.db.execute(
                "INSERT OR IGNORE INTO metadata_backups VALUES (1, ?)",
                (json.dumps(backup, ensure_ascii=False),),
            )
            connections = self.connections()
            if old and "config" in old:
                ident = LEGACY_CONNECTIONS[old["config"]["provider"]]
                connections.setdefault(ident, old)
                default_id = ident
            else:
                default_id = old.get("defaultConnectionId") if old else None
            for ident, value in connections.items():
                value = {
                    "config": {
                        "executablePath": "",
                        "reasoningEffort": "",
                        **value["config"],
                    },
                    "detection": normalized_detection(value["detection"]),
                    "revision": value.get("revision", 1),
                    "enabled": bool(old),
                    "check": {"status": "ready", "checkedAt": None, "error": None},
                }
                validate_metadata("AiConnection", {"id": ident, **value})
                self.db.execute(
                    "INSERT OR REPLACE INTO connections VALUES (?,?)",
                    (ident, json.dumps(value, ensure_ascii=False)),
                )
            preference = {
                "schemaVersion": 2,
                "revision": old.get("revision", 1) if old else 0,
                "enabled": bool(old),
                "defaultConnectionId": default_id,
            }
            self.db.execute(
                "INSERT OR REPLACE INTO config VALUES (1,?)", (json.dumps(preference),)
            )
            for row in self.db.execute("SELECT id,value FROM turns").fetchall():
                turn = upgrade_turn(json.loads(row["value"]))
                public_turn(turn)
                self.db.execute(
                    "UPDATE turns SET value=? WHERE id=?",
                    (json.dumps(turn, ensure_ascii=False), row["id"]),
                )
            self.db.execute("PRAGMA user_version=2")

    def _migrate_connections(self):
        if self.db.execute("PRAGMA user_version").fetchone()[0] >= 3:
            return
        with self.db:
            backup = {
                table: [dict(row) for row in self.db.execute(f"SELECT * FROM {table}")]
                for table in ["config", "connections", "bindings", "turns", "probes"]
            }
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS metadata_backups (version INTEGER PRIMARY KEY, value TEXT NOT NULL)"
            )
            self.db.execute(
                "INSERT OR IGNORE INTO metadata_backups VALUES (2,?)",
                (json.dumps(backup, ensure_ascii=False),),
            )
            preference = json.loads(
                self.db.execute("SELECT value FROM config WHERE id=1").fetchone()[0]
            )
            for ident, value in self.connections().items():
                value.update(
                    enabled=value.get("enabled", preference["enabled"]),
                    check=value.get(
                        "check", {"status": "unknown", "checkedAt": None, "error": None}
                    ),
                )
                validate_metadata("AiConnection", {"id": ident, **value})
                self.db.execute(
                    "UPDATE connections SET value=? WHERE id=?",
                    (json.dumps(value, ensure_ascii=False), ident),
                )
            preference["schemaVersion"] = 3
            self.db.execute(
                "UPDATE config SET value=? WHERE id=1", (json.dumps(preference),)
            )
            self.db.execute("PRAGMA user_version=3")

    def _migrate_default_model(self):
        row = self.db.execute("SELECT value FROM config WHERE id=1").fetchone()
        if row and "defaultModel" in json.loads(row[0]):
            return
        value = self.preferences()
        if row:
            value["revision"] += 1
        with self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO config VALUES (1, ?)", (json.dumps(value),)
            )

    def preferences(self):
        row = self.db.execute("SELECT value FROM config WHERE id=1").fetchone()
        value = (
            json.loads(row[0])
            if row
            else {
                "schemaVersion": 3,
                "revision": 0,
                "enabled": False,
                "defaultConnectionId": None,
            }
        )
        # 旧默认连接在读取边界转换为明确的模型引用，不改写历史会话。
        if "defaultModel" not in value:
            ident = value.get("defaultConnectionId")
            saved = self.connections().get(ident)
            value["defaultModel"] = (
                {"connectionId": ident, "modelId": saved["config"]["model"]}
                if saved
                and saved["enabled"]
                and saved["check"]["status"] != "error"
                and saved["config"]["model"]
                else None
            )
        value["defaultConnectionId"] = (
            value["defaultModel"]["connectionId"] if value["defaultModel"] else None
        )
        return value

    def config(self):
        # 旧内部调用的只读投影；保存源仅为默认连接编号与连接表。
        preference = self.preferences()
        saved = self.connections().get(preference["defaultConnectionId"])
        return saved if saved and saved["enabled"] else None

    def save_config(self, config):
        self.save_connection(
            LEGACY_CONNECTIONS[config["config"]["provider"]], config, make_default=True
        )

    def clear_config(self, expected_revision=None):
        from .errors import ConnectionError

        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            previous = self.preferences()
            if (
                expected_revision is not None
                and previous["revision"] != expected_revision
            ):
                raise ConnectionError(
                    "AI 配置已在其他窗口更新，请重新读取后再停用。",
                    "configuration_conflict",
                )
            previous.update(
                enabled=False,
                defaultConnectionId=None,
                defaultModel=None,
                revision=previous["revision"] + 1,
            )
            for ident, connection in self.connections().items():
                connection.update(enabled=False, revision=connection["revision"] + 1)
                self.db.execute(
                    "UPDATE connections SET value=? WHERE id=?",
                    (json.dumps(connection), ident),
                )
            self.db.execute(
                "INSERT OR REPLACE INTO config VALUES (1,?)", (json.dumps(previous),)
            )

    def _migrate_session_bindings(self):
        if self.db.execute("PRAGMA user_version").fetchone()[0] >= 4:
            return
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            rows = [dict(row) for row in self.db.execute("SELECT * FROM bindings")]
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS metadata_backups (version INTEGER PRIMARY KEY, value TEXT NOT NULL)"
            )
            self.db.execute(
                "INSERT OR IGNORE INTO metadata_backups VALUES (3,?)",
                (json.dumps({"bindings": rows}, ensure_ascii=False),),
            )
            self.db.execute("ALTER TABLE bindings RENAME TO bindings_v3")
            self.db.execute("""CREATE TABLE bindings (
                conversation_id TEXT NOT NULL, external_id TEXT NOT NULL,
                executable TEXT NOT NULL, workspace TEXT NOT NULL,
                harness_home TEXT NOT NULL DEFAULT '', connection_id TEXT NOT NULL,
                protocol TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
                state TEXT NOT NULL DEFAULT 'bound',
                PRIMARY KEY(conversation_id, connection_id)
            )""")
            self.db.execute("""INSERT INTO bindings
                (conversation_id, external_id, executable, workspace, harness_home,
                 connection_id, protocol, revision, state)
                SELECT conversation_id, external_id, executable, workspace, harness_home,
                       connection_id, protocol, revision, state FROM bindings_v3""")
            self.db.execute("DROP TABLE bindings_v3")
            self.db.execute("""CREATE TABLE IF NOT EXISTS session_receipts (
                connection_id TEXT NOT NULL, external_id TEXT NOT NULL,
                kind TEXT NOT NULL, receipt_key TEXT NOT NULL,
                PRIMARY KEY(connection_id, external_id, kind, receipt_key)
            )""")
            self.db.execute("PRAGMA user_version=4")

    def binding(self, conversation_id, connection_id=None):
        if connection_id:
            row = self.db.execute(
                "SELECT * FROM bindings WHERE conversation_id=? AND connection_id=?",
                (conversation_id, connection_id),
            ).fetchone()
            return dict(row) if row else None
        rows = self.db.execute(
            "SELECT * FROM bindings WHERE conversation_id=?", (conversation_id,)
        ).fetchall()
        # 旧调用仅可读取唯一关联，不能按行顺序猜测当前服务。
        return dict(rows[0]) if len(rows) == 1 else None

    def receipts(self, connection_id, external_id):
        result = {"content": set(), "message": set()}
        for row in self.db.execute(
            "SELECT kind,receipt_key FROM session_receipts WHERE connection_id=? AND external_id=?",
            (connection_id, external_id),
        ):
            result[row["kind"]].add(row["receipt_key"])
        return result

    def confirm_receipts(
        self, connection_id, external_id, contents, messages, turn=None
    ):
        with self.db:
            self.db.executemany(
                "INSERT OR IGNORE INTO session_receipts VALUES (?,?,?,?)",
                [
                    (connection_id, external_id, kind, key)
                    for kind, keys in [("content", contents), ("message", messages)]
                    for key in keys
                ],
            )
            if turn is not None:
                # 收件记录与执行中的确认时间在同一事务中保存。
                saved = {key: value for key, value in turn.items() if key != "task"}
                self.save_turn(saved)
                turn.update(saved)

    def restart_binding(self, conversation_id, connection_id, external_id):
        from .errors import ConnectionError

        with self.db:
            cursor = self.db.execute(
                "UPDATE bindings SET external_id='',state='creating',revision=revision+1 "
                "WHERE conversation_id=? AND connection_id=? AND external_id=? AND state='missing'",
                (conversation_id, connection_id, external_id),
            )
            if cursor.rowcount != 1:
                raise ConnectionError(
                    "原会话状态已变化，请重新读取后再确认。", "binding_mismatch"
                )

    def retain_binding_revision(
        self, conversation_id, connection_id, external_id, revision
    ):
        if revision is None:
            return
        # 同一原生编号在本机备份恢复后保持单调修订号，不以版本差异阻止恢复。
        with self.db:
            self.db.execute(
                "UPDATE bindings SET revision=MAX(revision,?) WHERE conversation_id=? AND connection_id=? AND external_id=?",
                (revision, conversation_id, connection_id, external_id),
            )

    def bind(
        self,
        conversation_id,
        external_id,
        executable,
        workspace,
        harness_home="",
        connection_id="deepseek-local",
        protocol="acp",
        revision=1,
    ):
        with self.db:
            self.db.execute(
                "INSERT INTO bindings (conversation_id, external_id, executable, workspace, harness_home, connection_id,protocol,state,revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    conversation_id,
                    external_id,
                    executable,
                    workspace,
                    harness_home,
                    connection_id,
                    protocol,
                    "bound" if external_id else "creating",
                    revision,
                ),
            )

    def complete_binding(self, conversation_id, external_id, connection_id=None):
        binding = self.binding(conversation_id, connection_id)
        if not binding:
            raise ValueError("Session binding was not found.")
        with self.db:
            self.db.execute(
                "UPDATE bindings SET external_id=?,state='bound',revision=revision+1 WHERE conversation_id=? AND connection_id=? AND external_id=''",
                (external_id, conversation_id, binding["connection_id"]),
            )

    def turn(self, ident):
        row = self.db.execute("SELECT value FROM turns WHERE id=?", (ident,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_turn(self, turn):
        previous = self.turn(turn["id"])
        updated = upgrade_turn(turn)
        updated["revision"] = (previous or {}).get("revision", 0) + 1
        public_turn(updated)
        turn.update(updated)
        with self.db:
            self.db.execute(
                "INSERT INTO turns VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                (
                    turn["id"],
                    turn["conversationId"],
                    json.dumps(turn, ensure_ascii=False),
                ),
            )

    def conversation_turns(self, ident):
        rows = self.db.execute(
            "SELECT value FROM turns WHERE conversation_id=? ORDER BY rowid DESC LIMIT 100",
            (ident,),
        ).fetchall()
        return [json.loads(row[0]) for row in reversed(rows)]

    def connections(self):
        return {
            row["id"]: json.loads(row["value"])
            for row in self.db.execute("SELECT * FROM connections")
        }

    def deleted_connections(self):
        return {
            row["id"]: row["revision"]
            for row in self.db.execute("SELECT id,revision FROM deleted_connections")
        }

    def delete_connection(
        self, ident, expected_revision, expected_preferences_revision
    ):
        from .errors import ConnectionError

        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            previous = self.connections().get(ident)
            deleted = self.deleted_connections().get(ident)
            # 同一次删除应答丢失后可以重试，不能删除后来重新配置的连接。
            if previous is None and deleted == expected_revision + 1:
                return
            preference = self.preferences()
            if (
                previous is None
                or previous["revision"] != expected_revision
                or preference["revision"] != expected_preferences_revision
            ):
                raise ConnectionError(
                    "AI 配置已在其他窗口更新，请重新读取后再删除。",
                    "configuration_conflict",
                )
            self.db.execute("DELETE FROM connections WHERE id=?", (ident,))
            self.db.execute(
                "INSERT OR REPLACE INTO deleted_connections VALUES (?,?,?)",
                (ident, expected_revision + 1, int(time() * 1000)),
            )
            if preference["defaultConnectionId"] == ident:
                preference["defaultConnectionId"] = None
                preference["defaultModel"] = None
            preference.update(
                revision=preference["revision"] + 1,
                enabled=any(value["enabled"] for value in self.connections().values()),
            )
            self.db.execute(
                "UPDATE config SET value=? WHERE id=1", (json.dumps(preference),)
            )

    def save_connection(
        self,
        ident,
        value,
        *,
        make_default=False,
        expected_revision=None,
        expected_preferences_revision=None,
    ):
        from .errors import ConnectionError

        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            previous = self.connections().get(ident)
            preference = self.preferences()
            if (
                expected_revision is not None
                and expected_revision != (previous or {}).get("revision", 0)
            ) or (
                expected_preferences_revision is not None
                and expected_preferences_revision != preference["revision"]
            ):
                raise ConnectionError(
                    "AI 配置已在其他窗口更新，请重新读取后再保存。",
                    "configuration_conflict",
                )
            normalized = {
                "config": value["config"],
                "detection": normalized_detection(value["detection"]),
                "revision": max(
                    (previous or {}).get("revision", 0),
                    self.deleted_connections().get(ident, 0),
                )
                + 1,
                "enabled": value.get("enabled", (previous or {}).get("enabled", True)),
                "check": value.get(
                    "check",
                    {"status": "ready", "checkedAt": int(time() * 1000), "error": None},
                ),
            }
            validate_metadata("AiConnection", {"id": ident, **normalized})
            if (
                previous
                and previous["config"]["provider"] != normalized["config"]["provider"]
            ):
                raise ValueError("A connection cannot change its Harness service.")
            self.db.execute(
                "INSERT OR REPLACE INTO connections VALUES (?, ?)",
                (ident, json.dumps(normalized, ensure_ascii=False)),
            )
            default = preference.get("defaultModel")
            if (
                default
                and default["connectionId"] == ident
                and (
                    not normalized["enabled"]
                    or default["modelId"]
                    not in {item["value"] for item in normalized["detection"]["models"]}
                )
            ):
                preference.update(
                    defaultConnectionId=None,
                    defaultModel=None,
                    revision=preference["revision"] + 1,
                )
                self.db.execute(
                    "UPDATE config SET value=? WHERE id=1", (json.dumps(preference),)
                )
            if make_default:
                if not normalized["enabled"]:
                    raise ConnectionError(
                        "请先检测连接，再设置全局默认模型。", "connection_disabled"
                    )
                preference.update(
                    enabled=True,
                    defaultConnectionId=ident,
                    defaultModel={
                        "connectionId": ident,
                        "modelId": normalized["config"]["model"],
                    },
                    revision=preference["revision"] + 1,
                )
                self.db.execute(
                    "INSERT OR REPLACE INTO config VALUES (1, ?)",
                    (json.dumps(preference),),
                )

    def set_default(self, ident, expected_revision, model_id=None):
        from .errors import ConnectionError

        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            preference = self.preferences()
            if preference["revision"] != expected_revision:
                raise ConnectionError(
                    "全局默认已在其他窗口更新，请重新读取。", "configuration_conflict"
                )
            connection = self.connections().get(ident)
            if (
                not connection
                or not connection["enabled"]
                or connection["check"]["status"] == "error"
            ):
                raise ConnectionError(
                    "该服务未连接，请先检测连接。",
                    "connection_unavailable",
                )
            selected = model_id or connection["config"]["model"]
            if selected not in {m["value"] for m in connection["detection"]["models"]}:
                raise ConnectionError(
                    "所选模型不在当前目录中，请重新检测。", "model_missing"
                )
            if connection["config"]["model"] != selected:
                connection["config"] = {
                    **connection["config"],
                    "model": selected,
                    "reasoningEffort": "",
                }
                connection["revision"] += 1
                self.db.execute(
                    "UPDATE connections SET value=? WHERE id=?",
                    (json.dumps(connection), ident),
                )
            preference.update(
                defaultConnectionId=ident,
                defaultModel={"connectionId": ident, "modelId": selected},
                enabled=True,
                revision=preference["revision"] + 1,
            )
            self.db.execute(
                "UPDATE config SET value=? WHERE id=1", (json.dumps(preference),)
            )

    def set_connection_state(self, ident, enabled, expected_revision):
        from .errors import ConnectionError

        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            value = self.connections().get(ident)
            if not value:
                raise ConnectionError("请先配置并保存该服务。", "not_configured")
            if value["revision"] != expected_revision:
                raise ConnectionError(
                    "连接配置已在其他窗口更新，请重新读取。", "configuration_conflict"
                )
            value.update(enabled=enabled, revision=value["revision"] + 1)
            self.db.execute(
                "UPDATE connections SET value=? WHERE id=?", (json.dumps(value), ident)
            )
            if not enabled:
                preference = self.preferences()
                if preference["defaultConnectionId"] == ident:
                    preference.update(
                        defaultConnectionId=None,
                        defaultModel=None,
                        revision=preference["revision"] + 1,
                    )
                    self.db.execute(
                        "UPDATE config SET value=? WHERE id=1",
                        (json.dumps(preference),),
                    )

    def record_connection_check(self, ident, status, error=None):
        # 检测状态独立更新，失败时不覆盖已保存的安装位置和模型目录。
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            value = self.connections().get(ident)
            if value:
                value.update(
                    check={
                        "status": status,
                        "checkedAt": int(time() * 1000),
                        "error": error,
                    },
                    revision=value["revision"] + 1,
                )
                self.db.execute(
                    "UPDATE connections SET value=? WHERE id=?",
                    (json.dumps(value, ensure_ascii=False), ident),
                )

    def binding_metadata(self, ident, connection_id=None):
        value = self.binding(ident, connection_id)
        if value is None:
            return None
        result = {
            "conversationId": ident,
            "connectionId": value["connection_id"],
            "protocol": value["protocol"],
            "externalSessionId": value["external_id"] or None,
            "state": value["state"],
            "revision": value["revision"],
        }
        validate_metadata("SessionBinding", result)
        return result

    def mark_binding(self, ident, state, connection_id=None):
        binding = self.binding(ident, connection_id)
        if not binding:
            return
        with self.db:
            self.db.execute(
                "UPDATE bindings SET state=?,revision=revision+1 WHERE conversation_id=? AND connection_id=?",
                (state, ident, binding["connection_id"]),
            )

    def probe(self, ident):
        row = self.db.execute(
            "SELECT session_id FROM probes WHERE id=?", (ident,)
        ).fetchone()
        return dict(row) if row else None

    def save_probe(self, ident, sid):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO probes VALUES (?, ?)", (ident, sid))

    def reset_probe(self, ident):
        with self.db:
            self.db.execute("DELETE FROM probes WHERE id=?", (ident,))
