"""Poll GitHub for combined commit status + check-runs until terminal.

Emits one line per change. Exits 0 when status reaches success/failure/error.
"""
import json, sys, time, urllib.request

SHA = sys.argv[1]
prev = ""
for i in range(60):
    try:
        s = json.loads(urllib.request.urlopen(
            f"https://api.github.com/repos/gschiemann/EDUCMS/commits/{SHA}/status",
            timeout=15).read())
        c = json.loads(urllib.request.urlopen(
            f"https://api.github.com/repos/gschiemann/EDUCMS/commits/{SHA}/check-runs",
            timeout=15).read())
    except Exception as e:
        print(f"[{i}] fetch-error: {e}", flush=True)
        time.sleep(30)
        continue
    lines = []
    lines.append(f"STATUS: {s.get('state','-')}")
    for st in s.get('statuses', []):
        lines.append(f" ext: {st['context']}: {st['state']}")
    chk = c.get('check_runs', [])
    done = sum(1 for x in chk if x['status'] == 'completed')
    fail = [x['name'] for x in chk if x.get('conclusion') in ('failure','cancelled','timed_out')]
    lines.append(f"CHECKS: {done}/{len(chk)}")
    if fail:
        lines.append(f"FAILS: {','.join(fail)}")
    cur = "\n".join(lines)
    if cur != prev:
        print(f"[{i}] " + cur, flush=True)
        prev = cur
    state = s.get('state')
    if state in ('success', 'failure', 'error'):
        print(f"TERMINAL: {state}", flush=True)
        sys.exit(0 if state == 'success' else 1)
    time.sleep(45)
print("TIMEOUT", flush=True)
sys.exit(2)
