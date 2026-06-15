import sqlite3
import sys

def main():
    print("=== SQLite version diagnostic ===")
    print("Python version:", sys.version)
    print("SQLite library version:", sqlite3.sqlite_version)

if __name__ == "__main__":
    main()
