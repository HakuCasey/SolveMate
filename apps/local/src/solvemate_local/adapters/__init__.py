from ..errors import ConnectionError
from .codex import CodexAdapter
from .dsh import DshAdapter
from .hermes import HermesAdapter


class AdapterRegistry:
    def __init__(self, adapters=None):
        self.adapters = (
            list(adapters)
            if adapters is not None
            else [DshAdapter(), HermesAdapter(), CodexAdapter()]
        )
        if len({adapter.id for adapter in self.adapters}) != len(self.adapters) or len(
            {adapter.provider for adapter in self.adapters}
        ) != len(self.adapters):
            raise ValueError("Harness adapter identifiers must be unique.")

    def provider(self, provider):
        for adapter in self.adapters:
            if adapter.provider == provider:
                return adapter
        raise ConnectionError("不支持该 AI 服务，请重新选择。", "provider_unsupported")

    def connection(self, ident):
        for adapter in self.adapters:
            if adapter.id == ident:
                return adapter
        raise ConnectionError("未找到该 AI 连接，请重新配置。", "connection_missing")
