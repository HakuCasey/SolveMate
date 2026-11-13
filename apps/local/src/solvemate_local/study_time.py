"""按本机日期合并学习时间段；多窗口及重复提交不会重复累计。"""

import json
import logging
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Request
from pydantic import Field

from .models import RequestModel
from .user_data import UserDataError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/local-api/v1/user/study")


class StudyInterval(RequestModel):
    startMs: int = Field(strict=True, ge=946684800000)
    endMs: int = Field(strict=True, ge=946684800000)


class StudyWrite(RequestModel):
    expectedStoreId: str
    intervals: list[StudyInterval] = Field(min_length=1, max_length=128)


def merge_intervals(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def validate_daily_duration(day, milliseconds):
    if not 0 <= milliseconds <= 86400000:
        logger.error(
            "Study duration exceeds the daily limit: day=%s milliseconds=%s",
            day,
            milliseconds,
        )
        raise UserDataError(
            "单日学习时长异常，本次统计未保存，原有记录已保留。",
            "study_duration_exceeded",
        )


class StudyTime:
    def __init__(self, user):
        self.user = user

    def summary(self):
        with self.user.lock:
            days = []
            for row in self.user.db.execute(
                "SELECT day,milliseconds FROM study_days ORDER BY day"
            ):
                validate_daily_duration(row["day"], row["milliseconds"])
                days.append({"date": row["day"], "milliseconds": row["milliseconds"]})
            return {
                "storeId": self.user.store_id,
                "today": datetime.now().date().isoformat(),
                "days": days,
            }

    def save(self, intervals, expected_store_id):
        if expected_store_id != self.user.store_id:
            raise UserDataError(
                "本机数据目录已变化，请重新打开应用。计时记录仍保留在当前浏览器。",
                "store_changed",
                409,
            )
        groups = {}
        now = int(time.time() * 1000)
        for item in intervals:
            start, end = item.startMs, item.endMs
            if end <= start or end - start > 86400000 or end > now + 300000:
                raise UserDataError("学习时间段无效，原有统计已保留。")
            while start < end:
                local = datetime.fromtimestamp(start / 1000)
                tomorrow = datetime.combine(
                    local.date() + timedelta(days=1), datetime.min.time()
                )
                boundary = min(end, int(tomorrow.timestamp() * 1000))
                groups.setdefault(local.date().isoformat(), []).append(
                    [start, boundary]
                )
                start = boundary
        with self.user.lock, self.user.db:
            for day, spans in groups.items():
                row = self.user.db.execute(
                    "SELECT intervals FROM study_days WHERE day=?", (day,)
                ).fetchone()
                merged = merge_intervals((json.loads(row[0]) if row else []) + spans)
                milliseconds = sum(end - start for start, end in merged)
                validate_daily_duration(day, milliseconds)
                self.user.db.execute(
                    "INSERT INTO study_days VALUES (?,?,?) "
                    "ON CONFLICT(day) DO UPDATE SET intervals=excluded.intervals, "
                    "milliseconds=excluded.milliseconds",
                    (day, json.dumps(merged, separators=(",", ":")), milliseconds),
                )
        return self.summary()


@router.get("")
def read_study(request: Request):
    return StudyTime(request.app.state.user).summary()


@router.post("")
def save_study(body: StudyWrite, request: Request):
    return StudyTime(request.app.state.user).save(body.intervals, body.expectedStoreId)
