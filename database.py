"""BabyWeb 数据库层：SQLAlchemy(sync) + SQLite，启用 WAL 支持家长并发录入。"""
import os
from datetime import datetime, date

from sqlalchemy import (
    create_engine, Column, Integer, String, Float, DateTime,
    Date, Boolean, Text, ForeignKey, event, select, text, inspect,
)
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "baby.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    future=True,
)

# WAL 模式：允许多个设备（爸妈的手机/电脑）同时读与写，家庭级并发无忧。
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, conn_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)
Base = declarative_base()


class Baby(Base):
    __tablename__ = "babies"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    birthday = Column(Date, nullable=False)
    gender = Column(String(10), default="")        # 男 / 女 / 未知
    note = Column(Text, default="")


class FeedingSession(Base):
    """一场喂养：一个开始时间（+可选结束时间/备注），可记录多种类型、不同奶量。"""
    __tablename__ = "feeding_sessions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    note = Column(Text, default="")
    legacy_id = Column(Integer, nullable=True, index=True)  # 旧 feedings 表迁移来源 id（幂等迁移用）
    created_at = Column(DateTime, default=datetime.utcnow)


class FeedingLog(Base):
    """一场喂养中的奶量明细：类型（母乳/奶粉/混合）+ 奶量。"""
    __tablename__ = "feeding_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("feeding_sessions.id"), nullable=False, index=True)
    feed_type = Column(String(20), nullable=False)  # breast/formula/mixed
    amount_ml = Column(Float, nullable=True)


class Sleep(Base):
    __tablename__ = "sleeps"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Diaper(Base):
    __tablename__ = "diapers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    diaper_type = Column(String(10), nullable=False)  # wet/poop/mixed
    time = Column(DateTime, nullable=True)              # 实际更换时间（可空，缺省用 created_at）
    stool_desc = Column(Text, default="")              # 便便描述（颜色+性状合并）
    photo_filename = Column(String(200), default="")   # 尿布照片（可选）
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Medication(Base):
    __tablename__ = "medications"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    med_name = Column(String(100), nullable=False)
    dose = Column(String(50), default="")
    time = Column(DateTime, nullable=False)            # 本次服药时间
    next_dose_at = Column(DateTime, nullable=True)      # 下次服药提醒时间
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Temperature(Base):
    __tablename__ = "temperatures"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    value = Column(Float, nullable=False)
    time = Column(DateTime, nullable=False)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Vaccine(Base):
    __tablename__ = "vaccines"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    done = Column(Boolean, default=False)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Growth(Base):
    __tablename__ = "growths"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    record_date = Column(Date, nullable=False)
    weight_kg = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    head_cm = Column(Float, nullable=True)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Milestone(Base):
    __tablename__ = "milestones"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    content = Column(Text, nullable=False)             # 标题+描述合并
    photo_id = Column(Integer, ForeignKey("photos.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Photo(Base):
    __tablename__ = "photos"
    id = Column(Integer, primary_key=True, autoincrement=True)
    baby_id = Column(Integer, ForeignKey("babies.id"), nullable=False, index=True)
    filename = Column(String(200), nullable=False)
    caption = Column(Text, default="")
    uploaded_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    Base.metadata.create_all(engine)
    migrate()
    migrate_legacy_feedings()


def migrate():
    """向前兼容：若旧版本已创建数据表但缺少新列，则自动 ALTER ADD。"""
    new_cols = {
        "medications": [("next_dose_at", "DATETIME")],
        "diapers": [("stool_desc", "TEXT"), ("photo_filename", "VARCHAR(200)"), ("time", "DATETIME")],
        "milestones": [("content", "TEXT")],
    }
    with engine.begin() as conn:
        for tbl, cols in new_cols.items():
            existing = {c["name"] for c in inspect(engine).get_columns(tbl)}
            for col, typ in cols:
                if col not in existing:
                    try:
                        conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col} {typ}"))
                    except Exception:
                        pass
        # 尿布 time 回填：旧记录无更换时间，用创建时间补齐（避免被日期过滤/排序遗漏）
        try:
            conn.execute(text("UPDATE diapers SET time = created_at WHERE time IS NULL"))
        except Exception:
            pass


def migrate_legacy_feedings():
    """把旧版扁平 feedings 表无损迁移为「会话 + 奶量明细」（幂等，按 legacy_id 去重）。

    旧 feedings 表原样保留（冻结为历史副本），新版代码只读写 feeding_sessions/feeding_logs。
    每次启动都会补迁移 legacy_id 尚未覆盖的旧行，因此升级前旧实例新写入的数据也不会丢。
    """
    insp = inspect(engine)
    if not insp.has_table("feedings"):
        return
    legacy_cols = {c["name"] for c in insp.get_columns("feedings")}
    if not {"id", "baby_id", "feed_type", "start_time"}.issubset(legacy_cols):
        return
    has_amount = "amount_ml" in legacy_cols
    has_end = "end_time" in legacy_cols
    has_note = "note" in legacy_cols

    with SessionLocal() as d:
        converted = set(
            d.execute(select(FeedingSession.legacy_id).where(FeedingSession.legacy_id.isnot(None))).scalars().all()
        )
        sel = "SELECT id, baby_id, feed_type, start_time"
        sel += ", end_time" if has_end else ", NULL"
        sel += ", amount_ml" if has_amount else ", NULL"
        sel += ", note" if has_note else ", ''"
        sel += " FROM feedings ORDER BY id"
        rows = d.execute(text(sel)).all()
        todo = [r for r in rows if r[0] not in converted]
        if not todo:
            return

        def _as_dt(x):
            """旧表里时间是 TEXT 存储（SQLite 动态类型），须解析为 datetime 才能进 ORM。"""
            if x is None or isinstance(x, datetime):
                return x
            try:
                return datetime.fromisoformat(str(x))
            except ValueError:
                return None

        for rid, bid, ftype, st, et, amt, note in todo:
            st2 = _as_dt(st)
            if st2 is None:
                continue    # 无法解析的行跳过（不记 converted），下次启动再试
            try:
                amt2 = None if amt is None else float(amt)
            except (TypeError, ValueError):
                amt2 = None
            sess = FeedingSession(
                baby_id=bid, start_time=st2, end_time=_as_dt(et),
                note=note or "", legacy_id=rid,
            )
            d.add(sess)
            d.flush()
            d.add(FeedingLog(session_id=sess.id, feed_type=ftype, amount_ml=amt2))
        d.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------- 单宝宝模式 ----------------
# “宝记”只服务一个宝宝：首次启动时自动创建默认宝宝（id=1），
# 所有录入均归到该宝宝，无需在界面上选择/管理多个宝宝。
def ensure_default_baby():
    with SessionLocal() as d:
        baby = d.execute(select(Baby).order_by(Baby.id)).scalars().first()
        if baby is None:
            baby = Baby(name="宝宝", birthday=date.today(), gender="未知")
            d.add(baby)
            d.commit()
    return baby


def get_single_baby_id() -> int:
    with SessionLocal() as d:
        baby = d.execute(select(Baby).order_by(Baby.id)).scalars().first()
        if baby is None:
            baby = ensure_default_baby()
        return baby.id
