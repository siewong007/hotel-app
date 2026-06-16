import json
import re

changes = {}

with open('errors.json', 'r') as f:
    for line in f:
        try:
            msg = json.loads(line)
        except:
            continue
        if msg.get('reason') != 'compiler-message':
            continue
        error = msg.get('message', {})
        if 'not satisfied' not in error.get('message', ''):
            continue
        if 'Decimal: sqlx::Encode' not in error.get('message', ''):
            continue
        
        spans = error.get('spans', [])
        for span in spans:
            if not span.get('is_primary'):
                continue
            file_name = span['file_name']
            line_num = span['line_start']
            
            if file_name not in changes:
                with open(file_name, 'r') as f2:
                    changes[file_name] = f2.readlines()
            
            lines = changes[file_name]
            target_line = lines[line_num - 1]
            if '.bind(' in target_line and 'decimal_to_db' not in target_line:
                # Handle cases like .bind(&var) or .bind(var)
                new_line = re.sub(r'\.bind\((&?.*?)\)', r'.bind(crate::core::db::decimal_to_db(\1))', target_line)
                lines[line_num - 1] = new_line

for file_name, lines in changes.items():
    with open(file_name, 'w') as f2:
        f2.writelines(lines)
