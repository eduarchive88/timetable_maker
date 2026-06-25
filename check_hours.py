import json
import solver

data = {
    "teacher_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 1학기 교사별시수표.xls",
    "g2_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 2학년 학급편성_3.7..xlsx",
    "g3_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 3학년 학급편성_3.3..xlsx",
    "group_file": r"c:\Users\eduar\OneDrive\Desktop\pretimetable\2026학년도 이동그룹_3.3..xlsx"
}

teacher_records = solver.parse_teacher_workload(data["teacher_file"])
moving_groups = solver.parse_moving_groups([(2, data["g2_file"]), (3, data["g3_file"])])
homeroom_classes, blocks, teachers = solver.prepare_solver_inputs(teacher_records, moving_groups)

grades_classes = set([(tr['grade'], str(tr['class_col'])) for tr in teacher_records])

homeroom_demands = {}
for hc in homeroom_classes:
    k = (hc['grade'], hc['class_col'])
    homeroom_demands[k] = homeroom_demands.get(k, 0) + hc['hours']
    
for b_key, block in blocks.items():
    unique_classes = set(str(c['class_col']) for c in block['classes'])
    for cls in unique_classes:
        k = (block['grade'], cls)
        homeroom_demands[k] = homeroom_demands.get(k, 0) + block['hours']

print("Class Hours Summary:")
for k, h in sorted(homeroom_demands.items()):
    if k[0] == 3:
        print(f"{k[0]}학년 {k[1]}반: {h}시간")
