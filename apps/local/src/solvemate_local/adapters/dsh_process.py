"""每个正在处理的原生会话独立使用 Host，共用连接配置与模型目录。"""

import asyncio
import json
import logging
import signal
from dataclasses import dataclass, field
from uuid import uuid4

from websockets.exceptions import ConnectionClosed

from ..acp import launch_spec
from ..errors import ConnectionError
from ..model_config import desktop_overlay
from ..processes import process_options, stop_process_tree
from .dsh_catalog import describe_catalog
from .dsh_host import DshHost, native_error, open_stream
from .dsh_stream import DshStream, StreamGap, records
from .types import HarnessSession

logger = logging.getLogger(__name__)
STOP_TIMEOUT = 10


@dataclass
class NativeSession:
    host: DshHost
    options: dict = field(default_factory=dict)
    selection: dict = field(default_factory=dict)
    stopped: bool = False
    finished: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    failure: Exception | None = None
    answered: set = field(default_factory=set)


class DshProcess:
    def __init__(
        self,
        executable,
        workspace,
        on_update=None,
        on_permission=None,
        *,
        harness_home,
        host_factory=DshHost,
    ):
        self.executable, self.workspace, self.home = (
            executable,
            str(workspace),
            harness_home,
        )
        self.on_update, self.on_permission = on_update, on_permission
        self.host_factory = host_factory
        self.sessions = {}
        self.starting = set()
        self.rows = []
        self.open = True
        self.version = "unknown"

    def is_running(self):
        # 单个 Host 退出只影响该会话，连接配置和其他会话仍可继续使用。
        return self.open

    async def start(self):
        argv, env = launch_spec(self.executable, "acp")
        env["DSH_HOME"] = str(self.home)
        overlay = await desktop_overlay(self.home, argv, env, process_options())
        self.rows = json.loads(overlay or "[]")
        # 版本查询不创建或恢复会话；启动和模型目录在实际使用时再次检查。
        argv, env = launch_spec(self.executable, "--version")
        env["DSH_HOME"] = str(self.home)
        child = await asyncio.create_subprocess_exec(
            *argv,
            env=env,
            **process_options(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            async with asyncio.timeout(8):
                out, _ = await child.communicate()
            if child.returncode:
                raise ConnectionError(
                    "无法读取 DSH 版本，请检查程序位置。", "program_start_failed"
                )
            self.version = out.decode("utf-8").strip()[:80]
        finally:
            if child.returncode is None:
                await stop_process_tree(
                    child, getattr(signal, "SIGKILL", signal.SIGTERM)
                )
                await asyncio.wait_for(child.wait(), 3)
        return {"version": self.version, "capabilities": {}}

    async def host(self, workspace):
        if not self.open:
            raise ConnectionError(
                "AI 连接已断开，请重新检测连接。", "connection_disabled"
            )
        host = self.host_factory(self.executable, workspace, self.home, self.rows)
        self.starting.add(host)
        try:
            await host.start()
            if not self.open:
                raise ConnectionError("AI 连接已断开。", "connection_disabled")
            return host
        except BaseException:
            await host.close()
            raise
        finally:
            self.starting.discard(host)

    async def catalog(self, selected=""):
        host = await self.host(self.workspace)
        try:
            return describe_catalog(await host.rpc("session/modelCatalog"), selected)
        finally:
            await host.close()

    async def rename(self, sid, title):
        # 管理原编号，不读取模型目录、不提交问题，也不创建替代会话。
        host = await self.host(self.workspace)
        try:
            result = await host.rpc(
                "session/rename", {"sessionId": sid, "title": title}
            )
            if not isinstance(result, dict) or result.get("title") != title:
                raise ConnectionError(
                    "DSH 未确认指定的会话名称，本地名称已保留，可再次保存重试。",
                    "rename_unconfirmed",
                )
        finally:
            await host.close()

    async def create(self, workspace):
        host = await self.host(workspace)
        try:
            result = await host.rpc("session/create", {"cwd": workspace})
            sid = result.get("sessionId")
            if not isinstance(sid, str) or not sid:
                raise ConnectionError(
                    "DSH 未返回有效的会话编号，未继续发送问题。", "session_invalid"
                )
            self.sessions[sid] = NativeSession(host)
            # 公共服务先保存编号，再读取可能失败的模型目录。
            return HarnessSession(sid, {})
        except BaseException:
            await host.close()
            raise

    async def resume(self, sid, workspace):
        if sid in self.sessions:
            raise ConnectionError("此 DSH 会话正在处理中，请等待完成。", "session_busy")
        host = await self.host(workspace)
        try:
            # 查询旧编号，绝不把 session/create 当作恢复。
            page = await host.snapshot(sid)
            header = page.get("header", {})
            if header.get("id", header.get("sessionId")) != sid:
                raise ConnectionError(
                    "DSH 返回的会话编号与原绑定不同。", "binding_mismatch"
                )
            self.sessions[sid] = NativeSession(host)
            return await self.inspect(sid)
        except BaseException:
            self.sessions.pop(sid, None)
            await host.close()
            raise

    async def inspect(self, sid):
        state = self.sessions[sid]
        state.options = describe_catalog(await state.host.rpc("session/modelCatalog"))
        return HarnessSession(sid, state.options)

    async def select(self, sid, model, effort=None):
        state = self.sessions[sid]
        options = describe_catalog(await state.host.rpc("session/modelCatalog"), model)
        if model not in {m["value"] for m in options["models"]}:
            raise ConnectionError(
                "所选模型不在 DSH 目录中，请重新选择。", "model_missing"
            )
        provider, name = json.loads(model)
        selection = {"sessionId": sid, "provider": provider, "model": name}
        if effort:
            selection["reasoningEffort"] = effort
        await state.host.rpc("session/selectModel", selection)
        state.selection, state.options = selection, options
        return options

    def emit(self, event):
        if self.on_update:
            self.on_update(event)

    async def prompt(self, sid, text, request_id=None):
        state = self.sessions[sid]
        if state.stopped:
            raise ConnectionError(
                "本次提问已取消，尚未发送给 DSH。", "submission_cancelled"
            )
        state.task = asyncio.current_task()
        try:
            async with asyncio.timeout(300):
                return await self.follow(state, sid, text, request_id or str(uuid4()))
        except (ValueError, KeyError, TypeError) as error:
            raise ConnectionError(
                "DSH 实时数据格式不受支持，请检查 Harness 版本；已有正文仍保留。",
                "protocol_invalid",
            ) from error
        except TimeoutError as error:
            raise ConnectionError(
                "等待 DSH 回复超时，已有内容仍保留，可恢复原会话后继续。",
                "execution_unconfirmed",
            ) from error
        finally:
            state.finished.set()

    async def repair(self, state, fold, snapshot):
        if fold.cut is not None:
            rows = records(snapshot)
            for _ in range(32):
                first = min((e["seq"] for e in rows), default=snapshot["cursor"] + 1)
                if first <= fold.cut + 1:
                    break
                page = await state.host.rpc(
                    "session/events",
                    {
                        "address": {"kind": "session", "sessionId": fold.sid},
                        "maxMessages": 500,
                        "throughSeq": first - 1,
                    },
                )
                older = records(page)
                if not older or min(e["seq"] for e in older) >= first:
                    raise ConnectionError(
                        "DSH 历史记录缺少必要片段，已有正文仍保留。",
                        "execution_unconfirmed",
                    )
                rows = older + rows
            else:
                raise ConnectionError(
                    "本轮历史记录过长，未自动继续，请查看原会话。",
                    "execution_unconfirmed",
                )
            snapshot = {**snapshot, "records": rows}
        fold.snapshot(snapshot)

    async def follow(self, state, sid, text, request_id):
        fold, submitted = DshStream(sid, self.emit), False
        attempts = 0
        death = asyncio.create_task(state.host.process.wait())
        try:
            while True:
                permissions = {}
                failure = asyncio.get_running_loop().create_future()
                socket = None
                receiver = None
                try:
                    socket = await state.host.subscribe("$events")
                    await open_stream(
                        socket,
                        "session/follow",
                        {
                            "address": {"kind": "session", "sessionId": sid},
                            "assistantStream": True,
                            "maxMessages": 500,
                        },
                    )
                    client_id, snapshot_ready = None, False
                    buffered = []
                    async with asyncio.timeout(15):
                        while not client_id or not snapshot_ready:
                            wire = json.loads(await socket.recv())
                            if wire.get("type") == "error":
                                raise native_error(wire.get("error"))
                            value = wire.get("value", {})
                            if value.get("type") == "ready":
                                client_id = value["clientId"]
                            elif value.get("type") == "snapshot":
                                await self.repair(state, fold, value)
                                snapshot_ready = True
                            else:
                                buffered.append(value)
                    for value in buffered:
                        if value.get("type") == "event":
                            fold.event(value["event"])
                        elif value.get("type") == "assistant-stream":
                            fold.frame(value["frame"])
                        elif value.get("type") == "waterfall":
                            await self.answer_event(
                                state, sid, client_id, value, permissions, failure
                            )
                    if not submitted:
                        if state.stopped:
                            raise ConnectionError(
                                "本次提问已取消，尚未发送给 DSH。",
                                "submission_cancelled",
                            )
                        current = await state.host.rpc(
                            "session/state", {"sessionId": sid}
                        )
                        if current.get("running") or current.get("queue"):
                            raise ConnectionError(
                                "原会话仍在处理上一条消息，请稍后继续。", "session_busy"
                            )
                        submitted = True
                        # 一次执行使用稳定请求编号；结果不明时仅重新订阅，不重复提交。
                        try:
                            await state.host.rpc(
                                "session/prompt",
                                {
                                    "requestId": request_id,
                                    "sessionId": sid,
                                    "mode": "queue",
                                    "content": [{"type": "text", "text": text}],
                                },
                            )
                        except ConnectionError as error:
                            if error.code != "native_transport_lost":
                                raise
                        else:
                            self.emit({"sessionId": sid, "kind": "received"})
                    while True:
                        if state.failure:
                            raise state.failure
                        if fold.result:
                            return fold.result
                        receiver = asyncio.create_task(socket.recv())
                        done, _ = await asyncio.wait(
                            {receiver, death, failure},
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        if death in done:
                            raise state.failure or ConnectionError(
                                "DSH 会话进程意外退出，已收到的正文仍保留，可恢复原会话后继续。",
                                "host_stopped",
                            )
                        if failure in done:
                            raise failure.result()
                        wire = json.loads(receiver.result())
                        receiver = None
                        if wire.get("type") == "error":
                            raise native_error(wire.get("error"))
                        value = wire.get("value", {})
                        kind = value.get("type")
                        if kind == "event":
                            fold.event(value["event"])
                        elif kind == "assistant-stream":
                            fold.frame(value["frame"])
                        elif kind == "cancel":
                            state.answered.add(value.get("eventId"))
                            pending_task = permissions.pop(value.get("eventId"), None)
                            if pending_task:
                                pending_task.cancel()
                                await asyncio.gather(
                                    pending_task, return_exceptions=True
                                )
                        elif kind == "waterfall":
                            await self.answer_event(
                                state, sid, client_id, value, permissions, failure
                            )
                except (
                    ConnectionClosed,
                    OSError,
                    StreamGap,
                    TimeoutError,
                    ConnectionError,
                ) as error:
                    if (
                        isinstance(error, ConnectionError)
                        and error.code != "native_transport_lost"
                    ):
                        raise
                    if permissions:
                        raise ConnectionError(
                            "权限确认期间连接中断，本轮已中断；请查看原会话后继续。",
                            "permission_interrupted",
                        ) from error
                    attempts += 1
                    if attempts > 3 or not state.host.is_running():
                        raise ConnectionError(
                            "DSH 实时连接无法恢复，已有正文仍保留，可恢复原会话后继续。",
                            "execution_unconfirmed",
                        ) from error
                    logger.info("Reopening DSH session stream: attempt=%s", attempts)
                    await asyncio.sleep(0.2 * attempts)
                finally:
                    if receiver:
                        receiver.cancel()
                        await asyncio.gather(receiver, return_exceptions=True)
                    tasks = list(permissions.values())
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    if socket:
                        await socket.close()
        finally:
            death.cancel()
            await asyncio.gather(death, return_exceptions=True)

    async def answer_event(self, state, sid, client_id, event, pending, failure):
        event_id = event["eventId"]
        if event_id in pending or event_id in state.answered:
            return
        if event.get("agentId") != sid or event.get("event") != "approval/request":
            await state.host.rpc(
                "$events/result",
                {
                    "clientId": client_id,
                    "eventId": event_id,
                    "outcome": {"kind": "next"},
                },
            )
            return

        async def answer():
            try:
                choice = None
                if self.on_permission and not state.stopped:
                    choice = await self.on_permission(
                        {
                            "sessionId": sid,
                            "title": "：".join(
                                str(value)
                                for value in [
                                    event.get("request", {}).get(
                                        "toolName", "工具执行"
                                    ),
                                    event.get("request", {}).get("reason"),
                                ]
                                if value
                            ),
                            "options": [
                                {
                                    "optionId": "allowed-once",
                                    "name": "仅允许这一次",
                                    "kind": "allow_once",
                                },
                                {
                                    "optionId": "rejected",
                                    "name": "拒绝",
                                    "kind": "reject_once",
                                },
                            ],
                        }
                    )
                if state.stopped:
                    return
                state.answered.add(event_id)
                await state.host.rpc(
                    "$events/result",
                    {
                        "clientId": client_id,
                        "eventId": event_id,
                        "outcome": {
                            "kind": "result",
                            "value": "allowed-once"
                            if choice == "allowed-once"
                            else "rejected",
                        },
                    },
                )
            except (ConnectionError, OSError, TimeoutError):
                if not failure.done():
                    failure.set_result(
                        ConnectionError(
                            "无法确认权限决定是否送达，本轮已中断；请查看原会话，避免重复执行。",
                            "permission_interrupted",
                        )
                    )
            finally:
                pending.pop(event_id, None)

        pending[event_id] = asyncio.create_task(answer())

    async def cancel(self, sid):
        state = self.sessions.get(sid)
        if not state:
            return
        state.stopped = True
        if not state.task or state.finished.is_set():
            return
        try:
            await state.host.rpc("session/cancel", {"sessionId": sid})
            await asyncio.wait_for(state.finished.wait(), STOP_TIMEOUT)
        except (ConnectionError, TimeoutError):
            state.failure = ConnectionError(
                "未能确认 DSH 已正常停止，已关闭本次进程并保留收到的内容。",
                "stop_unconfirmed",
            )
            await state.host.close()

    async def release(self, sid):
        state = self.sessions.get(sid)
        if state:
            await state.host.close()
            self.sessions.pop(sid, None)

    async def close(self):
        self.open = False
        await asyncio.gather(
            *(self.cancel(sid) for sid in list(self.sessions)), return_exceptions=True
        )
        results = await asyncio.gather(
            *(self.release(sid) for sid in list(self.sessions)),
            *(host.close() for host in list(self.starting)),
            return_exceptions=True,
        )
        if any(isinstance(result, BaseException) for result in results):
            raise ConnectionError(
                "未能关闭本应用启动的 DSH 进程，请检查进程权限后重试。",
                "disconnect_failed",
            )
