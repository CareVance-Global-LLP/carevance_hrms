filepath = r'D:\CareVance_Hrms_IDE\frontend\src\pages\AdminDashboard.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the start of the old return statement that needs to be removed
# It starts with "  return (" after the generateTrendFromTotal function
start_marker = None
for i in range(620, 680):
    if i < len(lines) and lines[i].strip() == 'return (' and i > 610:
        # Check if this is the PieChart return (comes after generateTrendFromTotal)
        start_marker = i - 2  # Go back to catch the empty line before
        break

if start_marker is None:
    print("ERROR: Cannot find start of old return statement")
    exit(1)

# Find the end - look for "};" followed by blank line and "export default"
end_marker = None
for i in range(start_marker + 5, start_marker + 60):
    if i < len(lines) and lines[i].strip() == '};':
        # Check if next non-empty line is "export default"
        for j in range(i + 1, min(i + 5, len(lines))):
            if lines[j].strip():
                if lines[j].strip().startswith('export default'):
                    end_marker = i + 1
                    break
        break

if end_marker is None:
    print("ERROR: Cannot find end of old function")
    exit(1)

print(f"Removing lines {start_marker + 1} to {end_marker}")

# Remove the old code
new_lines = lines[:start_marker] + lines[end_marker:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"SUCCESS: Removed old PieChart code (lines {start_marker + 1}-{end_marker})")
