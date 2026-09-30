"""宝记 每日数据备份：用 SQLite backup API 生成一致性快照（含 WAL 数据），并清理 N 天前的旧备份。

用法：
  python tools/backup_db.py                 # 默认保留 14 天
  python tools/backup_db.py --keep 30       # 保留 30 天
  python tools/backup_db.py --dest D:/bk    # 指定备份目录

说明：数据库启用 WAL 模式，近期事务可能尚未合并进主库文件，
直接复制 baby.db 会漏数据；本脚本走 sqlite3 backup API，服务运行中也可安全备份。
建议配合 Windows 任务计划程序每日执行一次。
"""
import os
import sys
import sqlite3
import argparse
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "baby.db")
DEFAULT_DEST = os.path.join(BASE_DIR, "data", "backups")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=14, help="保留最近多少天的备份（默认 14）")
    ap.add_argument("--dest", default=DEFAULT_DEST, help="备份目录")
    ap.add_argument("--db", default=DB_PATH, help="源数据库路径")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print("源数据库不存在：", args.db)
        sys.exit(1)

    os.makedirs(args.dest, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = os.path.join(args.dest, f"baby_{stamp}.db")
    src = sqlite3.connect(args.db)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)   # 一致性快照：即使 WAL 未 checkpoint 也能备全
    finally:
        dst.close()
        src.close()
    print("已备份 ->", dest)

    # 清理超过 keep 天的旧备份
    cutoff = datetime.now() - timedelta(days=args.keep)
    removed = 0
    for fn in os.listdir(args.dest):
        if not fn.startswith("baby_") or not fn.endswith(".db"):
            continue
        fp = os.path.join(args.dest, fn)
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(fp))
        except OSError:
            continue
        if mtime < cutoff:
            os.remove(fp)
            removed += 1
    print(f"清理完成：删除 {removed} 个超过 {args.keep} 天的旧备份")


if __name__ == "__main__":
    main()
