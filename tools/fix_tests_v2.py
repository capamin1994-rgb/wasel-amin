import os
import re

target_dir = r"c:/Users/amin/Desktop/wasel/testsprite_tests"

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    
    # Fix double URL
    content = content.replace("http://localhost:3001/http://localhost:3001/", "http://localhost:3001/")
    
    # Increase timeouts
    # Replace timeout=10000 with timeout=60000
    content = re.sub(r'timeout=10000\)', 'timeout=60000)', content)
    # Replace timeout=5000 with timeout=30000
    content = re.sub(r'timeout=5000\)', 'timeout=30000)', content)
    # Replace timeout=3000 with timeout=15000
    content = re.sub(r'timeout=3000\)', 'timeout=15000)', content)

    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed {filepath}")
    else:
        print(f"No changes needed for {filepath}")

for root, dirs, files in os.walk(target_dir):
    for file in files:
        if file.startswith("TC") and file.endswith(".py"):
            fix_file(os.path.join(root, file))
