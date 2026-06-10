content = open('main.py', encoding='utf-8').read()

replacements = [
    ('@app.get("/tickets/", response_model=list[TicketOut])', '@app.get("/tickets/")'),
    ('@app.get("/kb/articles/", response_model=list[KBArticleOut])', '@app.get("/kb/articles/")'),
    ('@app.get("/assets/", response_model=list[AssetOut])', '@app.get("/assets/")'),
    ('@app.get("/changes/", response_model=list[ChangeOut])', '@app.get("/changes/")'),
    ('@app.get("/canned-responses/", response_model=list[CannedResponseOut])', '@app.get("/canned-responses/")'),
    ('@app.get("/admin/users", response_model=list[UserOut])', '@app.get("/admin/users")'),
]

count = 0
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        print(f'Fixed: {old[:60]}')
        count += 1

open('main.py', 'w', encoding='utf-8').write(content)
print(f'\nDone — {count} replacements made.')
