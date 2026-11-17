"""使用 Hermes 原生 ACP 会话实现，握手只报告能力，不解析默认模型的凭据。"""

import asyncio
import logging
import sys


class FinalReplyMixin:
    async def _finish_reply(self, sid, editor_id, aid, payload):
        # 原生完成事件携带最终正文，可能已修订流式正文或附加工具失败说明。
        # 保留原生的取消、重放与工具收尾判断，用明确的完整正文事件代替再次追加。
        text = payload.get("text")
        if not hasattr(self, "_settled_replies"):
            self._settled_replies = {}
        if isinstance(text, str):
            self._settled_replies[sid] = "\n\n".join(
                [*self._segments.get(aid, []), text]
            )
        try:
            await super()._finish_reply(sid, editor_id, aid, payload)
        finally:
            self._settled_replies.pop(sid, None)

    def _chunk(self, sid, text, *, thought=False):
        settled = getattr(self, "_settled_replies", {})
        if sid in settled and not thought:
            update = super()._chunk(sid, settled[sid])
            update.field_meta = {"solvemate": {"textMode": "snapshot"}}
            return update
        return super()._chunk(sid, text, thought=thought)


def agent_class():
    import acp
    from acp.schema import (
        AgentCapabilities,
        Implementation,
        InitializeResponse,
        PromptCapabilities,
        SessionCapabilities,
        SessionForkCapabilities,
        SessionListCapabilities,
        SessionResumeCapabilities,
    )
    from acp_adapter.gateway_server import GatewayACPAgent
    from hermes_cli import __version__

    class HermesAgent(FinalReplyMixin, GatewayACPAgent):
        async def initialize(self, **kwargs):
            # 原生 initialize 为列认证方式而解析全局默认提供方，可能触发无关的
            # Nous 认证。此处仅报告协议能力；实际模型与凭据仍由原生会话处理。
            return InitializeResponse(
                protocol_version=acp.PROTOCOL_VERSION,
                agent_info=Implementation(name="hermes-agent", version=__version__),
                agent_capabilities=AgentCapabilities(
                    load_session=True,
                    prompt_capabilities=PromptCapabilities(image=True),
                    session_capabilities=SessionCapabilities(
                        fork=SessionForkCapabilities(),
                        list=SessionListCapabilities(),
                        resume=SessionResumeCapabilities(),
                    ),
                ),
                auth_methods=[],
            )

    return HermesAgent


async def serve():
    import acp

    agent = agent_class()()
    try:
        await acp.run_agent(agent, use_unstable_protocol=True)
    finally:
        # 只关闭本应用持有的 ACP 端，不结束原生会话或共享 Gateway。
        await agent.aclose()


def main():
    from acp_adapter.entry import (
        _load_env,
        _setup_logging,
        _warm_memory_provider_import,
    )
    from agent.ssl_verify import install_truststore

    _setup_logging()
    _load_env()
    install_truststore()
    if sys.platform == "win32":
        _warm_memory_provider_import(logging.getLogger(__name__))
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
