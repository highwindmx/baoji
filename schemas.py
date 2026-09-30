"""Pydantic 模型：请求校验 + 响应序列化（含计算字段）。"""
from __future__ import annotations

import datetime as _dt
from datetime import datetime, date, timedelta
from typing import Optional
from pydantic import BaseModel, computed_field


# ---------- Baby ----------
class BabyCreate(BaseModel):
    name: str
    birthday: date
    gender: str = ""
    note: str = ""


class BabyOut(BaseModel):
    id: int
    name: str
    birthday: date
    gender: str = ""
    note: str = ""

    @computed_field
    @property
    def dol(self) -> int:
        """出生天数（Day of Life），早产/双胎常用。"""
        return (date.today() - self.birthday).days


# ---------- Feeding（一场喂养 = 开始/结束/备注 + 多种奶量明细） ----------
class FeedingLogIn(BaseModel):
    feed_type: str                    # breast(母乳)/formula(奶粉)/mixed(混合)
    amount_ml: Optional[float] = None


class FeedingSessionCreate(BaseModel):
    baby_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    note: str = ""
    logs: list[FeedingLogIn] = []


class FeedingLogOut(BaseModel):
    id: int
    feed_type: str
    amount_ml: Optional[float] = None


class FeedingSessionOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    note: str = ""
    logs: list[FeedingLogOut] = []
    created_at: datetime

    @computed_field
    @property
    def total_ml(self) -> float:
        return float(sum((l.amount_ml or 0) for l in self.logs))

    @computed_field
    @property
    def duration_min(self) -> Optional[int]:
        if self.start_time and self.end_time:
            return int((self.end_time - self.start_time).total_seconds() // 60)
        return None


# ---------- Sleep ----------
class SleepCreate(BaseModel):
    baby_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    note: str = ""


class SleepOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    note: str = ""
    created_at: datetime

    @computed_field
    @property
    def duration_min(self) -> Optional[int]:
        if self.start_time and self.end_time:
            return int((self.end_time - self.start_time).total_seconds() // 60)
        return None


# ---------- Diaper ----------
class DiaperCreate(BaseModel):
    baby_id: Optional[int] = None
    diaper_type: str          # wet/poop/mixed
    time: Optional[datetime] = None   # 实际更换时间（空则记创建时间）
    stool_desc: str = ""      # 便便描述（颜色+性状合并）
    photo_filename: str = ""  # 尿布照片文件名（可选）
    note: str = ""


class DiaperOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    diaper_type: str
    time: Optional[datetime] = None
    stool_desc: str = ""
    photo_filename: str = ""
    note: str = ""
    created_at: datetime


# ---------- Medication ----------
class MedicationCreate(BaseModel):
    baby_id: Optional[int] = None
    med_name: str
    dose: str = ""
    time: datetime
    next_dose_at: Optional[datetime] = None  # 下次服药提醒时间
    note: str = ""


class MedicationOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    med_name: str
    dose: str = ""
    time: datetime
    next_dose_at: Optional[datetime] = None
    note: str = ""
    created_at: datetime


# ---------- Temperature ----------
class TemperatureCreate(BaseModel):
    baby_id: Optional[int] = None
    value: float
    time: datetime
    note: str = ""


class TemperatureOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    value: float
    time: datetime
    note: str = ""
    created_at: datetime


# ---------- Vaccine ----------
class VaccineCreate(BaseModel):
    baby_id: Optional[int] = None
    name: str
    date: Optional[_dt.date] = None
    due_date: Optional[_dt.date] = None
    done: bool = False
    note: str = ""


class VaccineOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    name: str
    date: Optional[_dt.date] = None
    due_date: Optional[_dt.date] = None
    done: bool = False
    note: str = ""
    created_at: datetime


# ---------- Growth ----------
class GrowthCreate(BaseModel):
    baby_id: Optional[int] = None
    record_date: date
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    head_cm: Optional[float] = None
    note: str = ""


class GrowthOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    record_date: date
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    head_cm: Optional[float] = None
    note: str = ""
    created_at: datetime


# ---------- Milestone ----------
class MilestoneCreate(BaseModel):
    baby_id: Optional[int] = None
    date: date
    content: str                 # 标题+描述合并
    photo_id: Optional[int] = None


class MilestoneOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    date: date
    content: str
    photo_id: Optional[int] = None
    created_at: datetime


# ---------- Photo ----------
class PhotoOut(BaseModel):
    id: int
    baby_id: Optional[int] = None
    filename: str
    caption: str = ""
    uploaded_at: datetime


# ---------- Summary ----------
class SummaryOut(BaseModel):
    baby_id: Optional[int] = None
    date: date
    feeding_count: int
    feeding_total_ml: float
    feeding_total_min: int
    sleep_count: int
    sleep_total_min: int
    diaper_count: int
    diaper_poop: int
