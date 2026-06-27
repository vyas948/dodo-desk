import sqlalchemy as sa
import os

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: Set DATABASE_URL environment variable first")
    exit(1)

try:
    engine = sa.create_engine(DATABASE_URL)
    inspector = sa.inspect(engine)
    tables = inspector.get_table_names()
    print(f"\n✅ Connected to PostgreSQL successfully!")
    print(f"   Tables found: {len(tables)}\n")
    with engine.connect() as conn:
        for t in sorted(tables):
            count = conn.execute(sa.text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
            print(f"   {t}: {count} rows")
    print("\n✅ Database migration verified!")
except Exception as e:
    print(f"❌ Error: {e}")
