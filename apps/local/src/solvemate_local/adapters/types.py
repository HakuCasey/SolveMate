from dataclasses import dataclass
from typing import Literal, TypedDict


@dataclass(frozen=True)
class HarnessSession:
    """公共服务只使用稳定编号与模型目录，不读取原生协议结构。"""

    id: str
    options: dict


class HarnessEvent(TypedDict, total=False):
    sessionId: str
    kind: Literal["text", "thinking", "tool", "turn", "received"]
    text: str
    replace: bool
    committed: bool
    id: str
    title: str
    status: str
    externalTurnId: str
