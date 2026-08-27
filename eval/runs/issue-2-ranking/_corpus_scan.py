import sqlite3

db = sqlite3.connect(r"C:\Users\joegc\projects\learn-rag\learn-rag\data\corpus.db")
db.row_factory = sqlite3.Row
print("one-way audio parents:")
for r in db.execute(
    """
    SELECT title, section, url, repo FROM parents
    WHERE lower(title || ' ' || section || ' ' || substr(body,1,4000))
          LIKE '%one-way audio%'
       OR lower(title || ' ' || section || ' ' || substr(body,1,4000))
          LIKE '%one way audio%'
    LIMIT 20
    """
):
    print(r["repo"], "|", r["title"][:60], "::", r["section"][:50])

print("\ngeo/redundan parents:")
for r in db.execute(
    """
    SELECT title, section, url, repo FROM parents
    WHERE lower(title || ' ' || section) LIKE '%redundan%'
       OR lower(title || ' ' || section) LIKE '%geo%'
       OR lower(section) LIKE '%failover mechanism%'
    LIMIT 30
    """
):
    print(r["repo"], "|", r["title"][:60], "::", r["section"][:55])
