import json

import pytest
from pydantic import ValidationError

from solvemate_local.models import TurnRequest
from solvemate_local.prompting import compose_prompt


def request(**extra):
    return TurnRequest.model_validate(
        {
            "id": "test-turn",
            "conversationId": "test-conversation",
            "userMessageId": "question-1",
            "text": "这里为什么使用指针？",
            "teacher": {"id": "test-bot", "name": "测试机器人", "prompt": "准确解释。"},
            **extra,
        }
    )


def context(page=20, content="int *p = &a;\n*p = 3;"):
    return {
        "title": f"C 语言课本 · 第 {page} 页",
        "content": content,
        "selection": {
            "courseId": "c-language",
            "version": "example-1",
            "kind": "textbooks",
            "itemId": "CB001",
            "chapterIndex": 0,
            "pageNumber": page,
        },
        "quoteKind": "page",
    }


def test_template_keeps_question_first_and_separates_current_page_and_four_fragments():
    page = context()
    fragments = [context(2 + i, f"补充片段 {i}") for i in range(4)]
    body = request(
        readingContext=page,
        references=fragments,
        history=[{"role": "user", "content": "上一轮问题"}],
    )
    prompt = compose_prompt(body, True)
    assert prompt.startswith(body.text + "\n\n")
    assert "本轮关联的阅读内容" in prompt
    assert "资料页码：第 20 页" in prompt
    assert json.dumps(page["content"], ensure_ascii=False) in prompt
    for fragment in fragments:
        assert prompt.count(fragment["content"]) == 1
    assert "上一轮问题" in prompt
    assert "上一轮问题" not in compose_prompt(body, False)
    assert "不要求按本模板的章节或顺序组织回答" in prompt


def test_old_requests_and_plain_chat_do_not_invent_a_linked_page():
    body = request(reference=context(2))
    prompt = compose_prompt(body, False)
    assert "本轮关联的阅读内容" not in prompt
    assert "本轮问题引用的课程资料" in prompt
    assert "readingContext" not in body.model_dump()
    with pytest.raises(ValidationError, match="关联内容尚未读取"):
        request(readingContext=context(content=" "))
