"""发布源文件、持久化目录与 HTTP 返回的数据约定。"""

from pathlib import PurePosixPath
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Text = Annotated[str, Field(min_length=1)]
Kind = Literal[
    "textbook",
    "questions",
    "learning-points",
    "discussion-points",
    "textbook-pdf",
    "textbook-pages",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceFile(Model):
    id: Text
    kind: Kind
    path: Text

    @field_validator("path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if (
            path.is_absolute()
            or ".." in path.parts
            or "\\" in value
            or "\x00" in value
            or path.as_posix() != value
            or value == "."
            or value == "course.json"
        ):
            raise ValueError("Content paths must be normalized relative paths.")
        return value


class CourseInfo(Model):
    id: Identifier
    title: Text
    description: Text
    release: Text


class CourseSpec(CourseInfo):
    files: list[SourceFile] = Field(min_length=4, max_length=6)

    @model_validator(mode="after")
    def complete_files(self) -> "CourseSpec":
        required = {"textbook", "questions", "learning-points", "discussion-points"}
        kinds = {item.kind for item in self.files}
        if len(kinds) != len(self.files) or kinds not in (
            required,
            required | {"textbook-pdf", "textbook-pages"},
        ):
            raise ValueError(
                "A course requires four source files and an optional PDF/index pair."
            )
        if len({item.path for item in self.files}) != len(self.files) or len(
            {item.id for item in self.files}
        ) != len(self.files):
            raise ValueError("Content IDs and paths must be unique within a course.")
        return self


class SourceCatalog(Model):
    schema_version: Literal[1]
    courses: list[CourseSpec] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_courses(self) -> "SourceCatalog":
        if len({item.id for item in self.courses}) != len(self.courses):
            raise ValueError("Course IDs must be unique.")
        return self


class ContentFile(SourceFile):
    media_type: str
    size_bytes: int = Field(ge=0)
    sha256: Digest


class ReleaseManifest(Model):
    schema_version: Literal[1] = 1
    course: CourseInfo
    version: Digest
    sha256: Digest
    size_bytes: int = Field(gt=0)
    files: list[ContentFile]
    download_url: str


class CatalogEntry(Model):
    course: CourseInfo
    latest_version: Digest
    versions: list[Digest] = Field(min_length=1)

    @model_validator(mode="after")
    def valid_versions(self) -> "CatalogEntry":
        if self.latest_version not in self.versions or len(set(self.versions)) != len(
            self.versions
        ):
            raise ValueError(
                "Published versions must be unique and include the latest version."
            )
        return self


class PublishedCatalog(Model):
    schema_version: Literal[1] = 1
    courses: list[CatalogEntry]

    @model_validator(mode="after")
    def unique_courses(self) -> "PublishedCatalog":
        if len({item.course.id for item in self.courses}) != len(self.courses):
            raise ValueError("Published course IDs must be unique.")
        return self


class CourseSummary(CourseInfo):
    latest_version: Digest
    manifest_url: str
    download_url: str


class CatalogResponse(Model):
    schema_version: Literal[1] = 1
    courses: list[CourseSummary]


class VersionsResponse(Model):
    course_id: str
    latest_version: Digest
    versions: list[ReleaseManifest]


class UpdateResponse(Model):
    course_id: str
    current_version: str | None
    status: Literal[
        "not_installed", "up_to_date", "update_available", "unknown_version"
    ]
    update_available: bool
    latest: ReleaseManifest


class Question(Model):
    id: Text
    title: Text
    topic: Text
    difficulty: Text
    question: Text
    answer: Text
    explanation: Text


class QuestionFile(Model):
    course: Text
    description: Text
    questions: list[Question] = Field(min_length=1)


class MemorySource(Model):
    textbook: Text
    question_ids: list[Text] = Field(min_length=1)


class LearningPoint(Model):
    id: Text
    title: Text
    content: Text
    common_mistake: Text
    source: MemorySource


class DiscussionPoint(Model):
    id: Text
    title: Text
    prompts: list[Text] = Field(min_length=1)
    guidance: Text
    source: MemorySource


class LearningFile(Model):
    course: Text
    origin: Text
    points: list[LearningPoint] = Field(min_length=1)


class DiscussionFile(Model):
    course: Text
    origin: Text
    points: list[DiscussionPoint] = Field(min_length=1)


class TextbookPages(Model):
    textbookId: Text
    sourceSha256: Digest
    pdfSha256: Digest
    pages: list[str] = Field(min_length=1, max_length=1000)
    chapterPages: list[int] = Field(min_length=1)
