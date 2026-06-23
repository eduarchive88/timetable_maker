import solver
import json
data = {
    "teacher_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 1학기 교사별시수표.xls",
    "g2_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 2학년 학급편성_3.7..xlsx",
    "g3_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 3학년 학급편성_3.3..xlsx",
    "group_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 이동그룹_3.3..xlsx"
}
import sys
sys.argv = ['solver.py', json.dumps(data)]
solver.main()
