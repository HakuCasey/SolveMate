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


def file_context(pages=(12, 13, 14, 15, 20)):
    return {
        "title": "C 语言课本 · 第 12–15、20 页",
        "content": "",
        "pageNumbers": list(pages),
        "selection": None,
        "material": {
            "materialId": "c-book",
            "contentVersion": "version-1",
            "pageNumber": pages[0],
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


def test_selected_pages_send_managed_pdf_once_without_extracted_text():
    from solvemate_local.prompting import prepare_prompt

    body = request(readingContext=file_context())
    body.readingContext.bind_resource("/managed/C language.pdf")
    first = prepare_prompt(body, {"content": set(), "message": set()})
    assert "指定页码：第 12–15、20 页" in first.text
    assert '资料文件："/managed/C language.pdf"' in first.text
    assert "请直接读取该 PDF 的指定页码" in first.text
    assert "原文：" not in first.text
    continued = prepare_prompt(
        body, {"content": set(first.content_keys), "message": set()}
    )
    assert "资料文件：" not in continued.text
    assert "资料文件和指定页码已在本会话提供" in continued.text
    assert not continued.content_keys


def test_selected_pages_require_ordered_pages_and_matching_return_position():
    with pytest.raises(ValidationError, match="升序"):
        request(readingContext=file_context((15, 12)))
    mismatched = file_context((12, 15))
    mismatched["material"]["pageNumber"] = 15
    with pytest.raises(ValidationError, match="返回位置"):
        request(readingContext=mismatched)


def test_content_identity_ignores_title_and_old_chapter_but_keeps_version_and_body():
    from solvemate_local.models import ReadingReference
    from solvemate_local.prompting import content_key, prepare_prompt

    first = context()
    renamed = {
        **first,
        "title": "renamed",
        "selection": {**first["selection"], "chapterIndex": 9},
    }
    a = ReadingReference.model_validate(first)
    assert content_key(a) == content_key(ReadingReference.model_validate(renamed))
    updated = {**first, "selection": {**first["selection"], "version": "new-version"}}
    assert content_key(a) != content_key(ReadingReference.model_validate(updated))
    body = request(readingContext=first, references=[first, renamed])
    prepared = prepare_prompt(body, {"content": set(), "message": set()})
    assert prepared.text.count("原文：") == 1
    assert len(prepared.content_keys) == 1
    repeat = prepare_prompt(
        body, {"content": set(prepared.content_keys), "message": set()}
    )
    assert "原文：" not in repeat.text
    assert not repeat.content_keys


def research_context():
    return {
        "kind": "question-research",
        "skill": {
            "id": "question-skill",
            "title": "试题研发",
            "content": "核对答案与解析，不编造依据。",
        },
        "template": {
            "id": "question-template",
            "title": "选择题模板",
            "content": "# 题目\n# 答案与解析",
        },
    }


def test_question_research_keeps_user_text_first_and_preserves_template_and_skill():
    body = request(
        text="生成三道选择题", readingContext=context(), research=research_context()
    )
    prompt = compose_prompt(body, False)
    assert prompt.startswith("生成三道选择题\n\n")
    assert "核对答案与解析，不编造依据。" in prompt
    assert "# 题目\n# 答案与解析" in prompt
    assert "int *p = &a;" in prompt
    assert "不要求按本模板的章节或顺序" not in prompt
    assert body.teacher.prompt == "准确解释。"
    with pytest.raises(ValidationError):
        request(research={**research_context(), "unrecognized": True})


def test_recreated_session_keeps_history_but_only_current_instructions():
    previous = research_context()
    previous["template"]["content"] = "旧版模板：只生成题干"
    body = request(
        research=research_context(),
        history=[
            {
                "id": "older-question",
                "role": "user",
                "content": "生成一道题",
                "research": previous,
            }
        ],
    )
    assert "旧版模板：只生成题干" not in compose_prompt(body, True)
    assert "生成一道题" in compose_prompt(body, True)
    assert "# 题目\n# 答案与解析" in compose_prompt(body, True)


def test_instruction_delivery_first_unchanged_each_part_and_return_to_a():
    from copy import deepcopy

    from solvemate_local.prompting import prepare_prompt

    task = research_context()
    receipts = {"content": set(), "message": set()}
    first = prepare_prompt(request(research=task), receipts)
    assert set(first.instruction_keys) == {"skill", "template"}
    receipts["instructions"] = first.instruction_keys
    same = prepare_prompt(request(research=task), receipts)
    assert same.instruction_keys == {}
    assert "【技能要求】" not in same.text
    assert "【输出模板】" not in same.text
    changed = deepcopy(task)
    changed["template"]["content"] = "模板 B"
    second = prepare_prompt(request(research=changed), receipts)
    assert set(second.instruction_keys) == {"template"}
    receipts["instructions"].update(second.instruction_keys)
    back = prepare_prompt(request(research=task), receipts)
    assert set(back.instruction_keys) == {"template"}
    assert "# 题目\n# 答案与解析" in back.text
    changed["skill"]["content"] = "技能 B"
    third = prepare_prompt(request(research=changed), receipts)
    assert set(third.instruction_keys) == {"skill"}
    fresh = prepare_prompt(request(research=task), receipts, fresh=True)
    assert set(fresh.instruction_keys) == {"skill", "template"}


def test_selection_sets_task_scope_and_page_remains_background_after_receipt():
    from solvemate_local.prompting import prepare_prompt

    page = context(content="参数传递；递归；数组。")
    excerpt = {**context(content="形参获得实参值的副本。"), "quoteKind": "selection"}
    body = request(readingContext=page, references=[excerpt])
    fresh = prepare_prompt(body, {"content": set(), "message": set()}, fresh=True)
    assert "本轮选段是任务对象" in fresh.text
    assert "用户明确指定的范围优先" in fresh.text
    assert "不能因为同页出现其他知识点就自动扩大任务范围" in fresh.text
    assert "本轮关联的阅读内容（补充背景）" in fresh.text
    assert "本轮选段（任务对象" in fresh.text
    assert page["content"] in fresh.text and excerpt["content"] in fresh.text
    continued = prepare_prompt(
        body, {"content": set(fresh.content_keys), "message": set(fresh.message_ids)}
    )
    assert "本轮选段是任务对象" in continued.text
    assert excerpt["content"] not in continued.text
    assert "原文已在本会话提供" in continued.text


def test_followup_keeps_existing_scope_and_allows_explicit_expansion():
    body = request(text="这次扩大到整页，加入递归。", readingContext=context())
    prompt = compose_prompt(body, False)
    assert prompt.startswith(body.text)
    assert "继续修改时沿用此前的范围" in prompt
    assert "用户明确要求整页、其他内容或扩大范围时，按该要求执行" in prompt
    assert "本轮选段是任务对象" not in prompt


@pytest.mark.parametrize("research", [None, research_context()])
def test_answers_are_self_contained_without_removing_source_identifiers(research):
    from solvemate_local.prompting import prepare_prompt

    page = context(content="C005：int n = 3; int result = add_ten(n);")
    body = request(readingContext=page, research=research)
    first = prepare_prompt(body, {"content": set(), "message": set()})
    continued = prepare_prompt(
        body, {"content": set(first.content_keys), "message": set(first.message_ids)}
    )
    for prompt in (first.text, continued.text):
        assert "不用资料编号、页码或‘见原文’代替解释" in prompt
        assert "给全必要的条件、代码和数据" in prompt
        assert "无需回看参考资料即可理解或作答" in prompt
        assert "资料名称、编号和页码可用于标注来源" in prompt
        assert "正常追问可承接已有对话" in prompt
        assert "资料不足时说明缺失，不补造条件" in prompt
    assert page["content"] in first.text
    assert not continued.content_keys
    assert "原文已在本会话提供" in continued.text
