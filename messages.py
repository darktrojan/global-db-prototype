from datetime import datetime
import sqlite3

year_folders = {
  2010: 11,
  2016: 12,
  2018: 13,
  2019: 14,
  2020: 15,
  2021: 16,
  2022: 19,
  2023: 20,
  2039: 21,
  2041: 22,
  2056: 23,
  2057: 24,
}

connection = sqlite3.connect("folders.sqlite")
cursor = connection.cursor()
cursor.execute("DROP TABLE IF EXISTS messages")
cursor.execute("""
    CREATE TABLE messages(
        msgid TEXT,
        msgdate INTEGER,
        msgfrom TEXT,
        msgsubject TEXT,
        folder INTEGER REFERENCES folders(id)
    )
""")

with open('messages.mbox') as infile:
    current = {}
    for line in infile:
        if line == '\n' and 'Date' in current:
            date = datetime.strptime(current["Date"], '%a, %d %b %Y %H:%M:%S %z')
            folder = year_folders.get(date.year) or 2

            current["Date"] = int(date.timestamp()) * 1000
            cursor.execute(
                "INSERT INTO messages VALUES(:msgid, :msgdate, :msgfrom, :msgsubject, :folder)",
                {
                    'msgid': current.get("Message-ID"),
                    'msgdate': current.get("Date"),
                    'msgfrom': current.get("From"),
                    'msgsubject': current.get("Subject"),
                    'folder': folder
                }
            )
            current = {}
        elif ': ' in line:
            [key, value] = line.strip().split(" ", 1)
            current[key.rstrip(":")] = value

    for row in cursor.execute("SELECT COUNT(*) FROM messages"):
        print(row)

connection.commit()
