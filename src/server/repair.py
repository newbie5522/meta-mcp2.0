import sqlite3
import traceback
import sys

def main():
    db_path = "prisma/dev.db"
    print("=== Testing connection variants on dev.db ===")

    variants = [
        {"desc": "Standard connection", "args": (db_path,), "kwargs": {}},
        {"desc": "URI Read Only connection", "args": ("file:prisma/dev.db?mode=ro",), "kwargs": {"uri": True}},
        {"desc": "Memory-forced backup", "args": (":memory:",), "kwargs": {}}
    ]

    for var in variants:
        desc = var["desc"]
        print(f"\n--- {desc} ---")
        try:
            if desc == "Memory-forced backup":
                mem_conn = sqlite3.connect(":memory:")
                # Try to copy disk file into memory
                disk_conn = sqlite3.connect("file:prisma/dev.db?mode=ro", uri=True)
                disk_conn.backup(mem_conn)
                print("Online backup to memory succeeded!")
                cursor = mem_conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master;")
                print("Tables:", cursor.fetchall())
                mem_conn.close()
                disk_conn.close()
            else:
                conn = sqlite3.connect(*var["args"], **var["kwargs"])
                print("Connected!")
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master;")
                print("Tables:", cursor.fetchall())
                conn.close()
        except Exception as e:
            print(f"Failed: {e}")
            traceback.print_exc()

if __name__ == "__main__":
    main()
