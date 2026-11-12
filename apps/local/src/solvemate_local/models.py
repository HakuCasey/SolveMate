from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from .metadata import SCHEMA, upgrade_conversation_metadata, validate_metadata

Provider = Literal[tuple(SCHEMA["$defs"]["ProviderId"]["enum"])]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ConnectionConfig(RequestModel):
    makeDefault: bool = True  # 旧客户端保存时沿用原行为；新版显式传入 False。
    enabled: bool = True
    expectedRevision: int | None = Field(default=None, ge=0)
    expectedPreferencesRevision: int | None = Field(default=None, ge=0)
    provider: Provider = "deepseek-harness"
    executablePath: str = Field(default="", max_length=2000)
    model: str = Field(default="", max_length=1000)
    reasoningEffort: str = Field(default="", max_length=100)

    @model_validator(mode="after")
    def shared_contract(self):
        validate_metadata(
            "AiConfig",
            self.model_dump(
                exclude={
                    "expectedRevision",
                    "expectedPreferencesRevision",
                    "makeDefault",
                    "enabled",
                }
            ),
        )
        return self


class PreferenceChange(RequestModel):
    expectedRevision: int | None = Field(default=None, ge=0)


class MaterialCourseChange(RequestModel):
    courseId: str | None
    expectedRevision: int = Field(ge=1)


class MaterialRename(RequestModel):
    title: str = Field(min_length=1, max_length=240)
    expectedRevision: int = Field(ge=1)

    @model_validator(mode="after")
    def valid_title(self):
        self.title = self.title.strip()
        if not self.title or any(ord(char) < 32 for char in self.title):
            raise ValueError("资料名称不能为空或包含控制字符。")
        return self


class MaterialDelete(RequestModel):
    expectedRevision: int = Field(ge=1)


class ConnectionState(RequestModel):
    expectedRevision: int = Field(ge=1)
    enabled: bool


class ConnectionDelete(RequestModel):
    expectedRevision: int = Field(ge=1)
    expectedPreferencesRevision: int = Field(ge=0)


class DefaultConnection(RequestModel):
    expectedRevision: int = Field(ge=0)
    connectionId: str = Field(min_length=1, max_length=100)


class DetectRequest(RequestModel):
    provider: Provider = "deepseek-harness"
    resetProbe: bool = False
    executablePath: str = Field(default="", max_length=2000)
    model: str = Field(default="", max_length=1000)


class SessionRename(RequestModel):
    title: str = Field(min_length=1, max_length=100)
    connectionId: str = Field(min_length=1, max_length=100)
    externalSessionId: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid_title(self):
        self.title = self.title.strip()
        if not self.title or any(ord(char) < 32 for char in self.title):
            raise ValueError("对话名称不能为空或包含控制字符。")
        return self


class Teacher(RequestModel):
    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    prompt: str = Field(max_length=20000)
    icon: Literal["graduation-cap", "sparkles", "bot"] = "bot"


class ReadingReference(RequestModel):
    title: str = Field(max_length=500)
    content: str = Field(max_length=100000)
    selection: dict | None
    material: dict | None = Field(default=None, exclude_if=lambda value: value is None)
    quoteKind: Literal["page", "selection"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def shared_reference(self):
        validate_metadata("ReadingReference", self.model_dump())
        return self


class HistoryMessage(RequestModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=100000)


class TurnRequest(RequestModel):
    _legacy_conversation_snapshot: dict | None = PrivateAttr(default=None)
    conversationSnapshot: dict | None = None
    connectionRevision: int | None = Field(default=None, ge=1)
    robotRevision: int | None = Field(default=None, ge=1)
    client: dict | None = None
    externalSessionId: str | None = Field(default=None, max_length=1000)
    connectionId: str = Field(default="", max_length=100)
    id: str = Field(pattern=r"^[a-zA-Z0-9-]{1,100}$")
    conversationId: str = Field(pattern=r"^[a-zA-Z0-9-]{1,100}$")
    userMessageId: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=10000)
    teacher: Teacher
    model: str = Field(default="", max_length=1000)
    reasoningEffort: str = Field(default="", max_length=100)
    reference: ReadingReference | None = None
    references: list[ReadingReference] = Field(
        default_factory=list,
        max_length=SCHEMA["$defs"]["TurnInput"]["properties"]["references"]["maxItems"],
    )
    history: list[HistoryMessage] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def shared_contract(self):
        if self.conversationSnapshot:
            if self.conversationSnapshot.get("schemaVersion") == 2:
                self._legacy_conversation_snapshot = self.conversationSnapshot
            self.conversationSnapshot = upgrade_conversation_metadata(
                self.conversationSnapshot
            )
        if self.references and self.reference:
            raise ValueError("不能同时提交单条引用和引用列表。")
        references = self.references or ([self.reference] if self.reference else [])
        if sum(len(item.content) for item in references) > 100000:
            raise ValueError("引用内容总长度过长，请先移除部分引用。")
        value = self.model_dump()
        for field in [
            "conversationSnapshot",
            "connectionRevision",
            "robotRevision",
            "client",
        ]:
            if value[field] is None:
                value.pop(field)
        validate_metadata("TurnInput", value)
        return self


class PermissionDecision(RequestModel):
    requestId: str = Field(max_length=200)
    optionId: str = Field(max_length=500)
