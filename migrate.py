import sqlite3

conn = sqlite3.connect('test.db')

# Security configs table
conn.execute('''CREATE TABLE IF NOT EXISTS security_configs (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER UNIQUE,
    mfa_enabled BOOLEAN DEFAULT 0,
    mfa_required BOOLEAN DEFAULT 0,
    sso_enabled BOOLEAN DEFAULT 0,
    sso_provider VARCHAR DEFAULT "google",
    sso_client_id VARCHAR DEFAULT "",
    sso_client_secret VARCHAR DEFAULT "",
    sso_domain VARCHAR DEFAULT "",
    sso_tenant_id VARCHAR DEFAULT "",
    updated_at DATETIME
)''')
print("Created security_configs table")

# Add change_id to ticket_approvals if not exists
cols = [r[1] for r in conn.execute('PRAGMA table_info(ticket_approvals)').fetchall()]
if 'change_id' not in cols:
    conn.execute('ALTER TABLE ticket_approvals ADD COLUMN change_id INTEGER')
    print('Added ticket_approvals.change_id')

conn.commit()
conn.close()
print('Migration complete.')
