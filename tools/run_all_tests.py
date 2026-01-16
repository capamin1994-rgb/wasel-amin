import os
import subprocess
import glob
import time

test_dir = r"c:/Users/amin/Desktop/wasel/testsprite_tests"
report_file = r"c:/Users/amin/Desktop/wasel/testsprite_tests/final_manual_report.md"

def run_tests():
    test_files = glob.glob(os.path.join(test_dir, "TC*.py"))
    results = []
    
    print(f"Found {len(test_files)} tests. Starting execution...")
    
    for i, test_file in enumerate(test_files, 1):
        test_name = os.path.basename(test_file)
        print(f"[{i}/{len(test_files)}] Running {test_name}...")
        
        start_time = time.time()
        try:
            # Run the test file
            result = subprocess.run(
                ["python", test_file],
                cwd=r"c:/Users/amin/Desktop/wasel",
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace' # Handle encoding errors gracefully
            )
            duration = time.time() - start_time
            
            status = "PASS" if result.returncode == 0 else "FAIL"
            error_msg = result.stderr if result.returncode != 0 else ""
            
            # If failed, try to extract specific assertion error line
            if status == "FAIL":
                 lines = error_msg.split('\n')
                 assertion_lines = [l for l in lines if "AssertionError" in l or "Error:" in l]
                 if assertion_lines:
                     error_msg = assertion_lines[-1] # Take the last error line
                 else:
                     error_msg = error_msg[-300:] # Last 300 chars if no obvious error
            
            results.append({
                "name": test_name,
                "status": status,
                "duration": round(duration, 2),
                "error": error_msg.strip()
            })
            
            print(f"  -> {status} ({duration:.2f}s)")
            
        except Exception as e:
            print(f"  -> ERROR executing file: {e}")
            results.append({
                "name": test_name,
                "status": "ERROR",
                "duration": 0,
                "error": str(e)
            })

    # Generate Report
    with open(report_file, "w", encoding='utf-8') as f:
        f.write("# Final Frontend Test Report (Manual Execution)\n\n")
        f.write(f"**Date:** {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Total Tests:** {len(test_files)}\n")
        f.write(f"**Passed:** {len([r for r in results if r['status'] == 'PASS'])}\n")
        f.write(f"**Failed:** {len([r for r in results if r['status'] != 'PASS'])}\n\n")
        
        f.write("| Test Case | Status | Duration | Error Note |\n")
        f.write("|-----------|--------|----------|------------|\n")
        for r in results:
            # Escape pipes in error message to avoid breaking table
            safe_error = r['error'].replace("|", "\|").replace("\n", " ")
            icon = "✅" if r['status'] == "PASS" else "❌"
            f.write(f"| {r['name']} | {icon} {r['status']} | {r['duration']}s | {safe_error} |\n")
            
    print(f"\nReport generated at: {report_file}")

if __name__ == "__main__":
    run_tests()
