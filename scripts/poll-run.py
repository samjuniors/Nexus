#!/usr/bin/env python3
"""Poll a run's status/phase/event-count until done or error."""
import sqlite3
import sys
import time

RUN_ID = sys.argv[1]
TIMEOUT_S = int(sys.argv[2]) if len(sys.argv) > 2 else 300

con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()
start = time.time()
while time.time() - start < TIMEOUT_S:
    row = cur.execute(
        'SELECT status, phase FROM Run WHERE id = ?', (RUN_ID,)
    ).fetchone()
    if not row:
        print('run not found')
        sys.exit(1)
    status, phase = row
    n = cur.execute(
        'SELECT COUNT(*) FROM RunEvent WHERE runId = ?', (RUN_ID,)
    ).fetchone()[0]
    elapsed = int(time.time() - start)
    print(f'[{elapsed}s] {status}/{phase} events={n}', flush=True)
    if status in ('done', 'error', 'stopped'):
        for t, d in cur.execute(
            'SELECT type, data FROM RunEvent WHERE runId = ? ORDER BY seq', (RUN_ID,)
        ).fetchall():
            if t in ('error', 'final'):
                print(f'  {t}:', d[:220])
        sys.exit(0)
    time.sleep(12)
print('timeout waiting for run')
sys.exit(2)
