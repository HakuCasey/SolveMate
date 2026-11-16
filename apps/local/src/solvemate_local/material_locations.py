"""旧课程位置只在读取旧记录时转换；正式引用使用资料编号、版本与页码或题号。"""

import copy
import json


def location(value):
    if not isinstance(value, dict):
        return value
    if {"courseId", "kind", "itemId", "version"} <= value.keys():
        if value["kind"] == "textbooks" and "pageNumber" in value:
            return {
                "materialId": f"{value['courseId']}:textbooks:{value['itemId']}",
                "contentVersion": value["version"],
                "pageNumber": value["pageNumber"],
            }
        if value["kind"] == "questions":
            return {
                "materialId": f"{value['courseId']}:questions",
                "contentVersion": value["version"],
                "questionId": value["itemId"],
            }
    return value


def convert_key(key, document=False):
    if not key.startswith("content:"):
        return key
    try:
        parts = json.loads(key[8:])
        course, version, kind, item = parts[:4]
        value = location(
            {
                "courseId": course,
                "version": version,
                "kind": kind,
                "itemId": item,
                **(
                    {"pageNumber": parts[4] if len(parts) > 4 else 1}
                    if kind == "textbooks"
                    else {}
                ),
            }
        )
        if "materialId" not in value:
            return key
        if document:
            return "material:" + json.dumps(
                [value["materialId"], version],
                ensure_ascii=False,
                separators=(",", ":"),
            )
        return f"{value['materialId']}/{version}/" + (
            ("question:" + item) if kind == "questions" else str(value["pageNumber"])
        )
    except (ValueError, IndexError, TypeError):
        return key


def unify_locations(value, root=True):
    if isinstance(value, list):
        return [unify_locations(item, False) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: unify_locations(item, False) for key, item in value.items()}
    if root:
        result = copy.deepcopy(result)
    if isinstance(result.get("selection"), dict):
        converted = location(result["selection"])
        if "materialId" in converted:
            if root:
                if not result.get("materialSelection"):
                    result["materialSelection"] = converted
            else:
                if not result.get("material"):
                    result["material"] = converted
                result["selection"] = None
                if "content" in result and "title" in result:
                    result.setdefault("quoteKind", "page")
    if isinstance(result.get("source"), dict):
        result["source"] = location(result["source"])
    if isinstance(result.get("location"), dict):
        result["location"] = location(result["location"])
    if "positions" in result and "documents" in result:
        result["positions"] = {
            convert_key(key): val for key, val in result["positions"].items()
        }
        result["documents"] = {
            convert_key(key, True): val for key, val in result["documents"].items()
        }
    return result
