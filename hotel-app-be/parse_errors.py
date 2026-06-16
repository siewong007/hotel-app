import json
with open('errors.json', 'r') as f:
    for line in f:
        try: msg = json.loads(line)
        except: continue
        if msg.get('reason') != 'compiler-message': continue
        error = msg.get('message', {})
        if 'not satisfied' in error.get('message', '') and 'Decimal: sqlx::Decode' in error.get('message', ''):
            for span in error.get('spans', []):
                if span.get('is_primary'):
                    print(f"Decode error: {span['file_name']}:{span['line_start']}")
