import sys
import json
import pandas as pd
import re
import traceback

def parse_teacher_workload(filepath):
    df = pd.read_excel(filepath, header=None)
    header_row_idx = -1
    for i in range(len(df)):
        row_vals = [str(x).strip() for x in df.iloc[i].values]
        if '1학년' in row_vals or '교사명' in row_vals or '단축과목명' in row_vals:
            header_row_idx = i
            break
            
    if header_row_idx == -1:
        raise Exception("Cannot find header row in teacher workload file.")
        
    row0 = df.iloc[header_row_idx].ffill().values
    row1 = df.iloc[header_row_idx+1].values
    
    grade_class_cols = []
    teacher_col = -1
    subject_col = -1
    
    for c in range(len(row0)):
        val0 = str(row0[c]).strip()
        val1 = str(row1[c]).strip()
        
        if '교사명' in val0 or '교사명' in val1:
            teacher_col = c
        elif '정식과목명' in val0 or '정식과목명' in val1:
            subject_col = c
        elif '단축과목명' in val0 or '단축과목명' in val1:
            if subject_col == -1: subject_col = c
            
        if '학년' in val0:
            grade_match = re.search(r'([1-3])학년', val0)
            if grade_match:
                grade = int(grade_match.group(1))
                try:
                    class_num = int(float(val1)) if str(val1).replace('.','',1).isdigit() else str(val1)
                    grade_class_cols.append((grade, str(class_num), c))
                except:
                    pass

    records = []
    for i in range(header_row_idx+2, len(df)):
        teacher = str(df.iloc[i, teacher_col]).strip() if teacher_col != -1 else ""
        subject = str(df.iloc[i, subject_col]).strip() if subject_col != -1 else ""
        
        if teacher == 'nan' or not teacher or subject == 'nan' or not subject:
            continue
            
        for grade, cls, c in grade_class_cols:
            val = df.iloc[i, c]
            if pd.notna(val) and str(val).strip() != '':
                try:
                    hours = float(val)
                    if hours > 0:
                        records.append({
                            'teacher': teacher,
                            'subject': subject,
                            'grade': grade,
                            'class_col': cls,
                            'hours': int(hours)
                        })
                except:
                    pass
    return records

def parse_moving_groups(filepaths):
    groups = []
    regex = re.compile(r'^([A-Z][0-9]?)_(.+)_([0-9]+)반$')
    
    for grade, filepath in filepaths:
        if not filepath: continue
        try:
            xls = pd.ExcelFile(filepath)
            for sheet in xls.sheet_names:
                df = pd.read_excel(xls, sheet_name=sheet)
                for col in df.columns:
                    for val in df[col]:
                        v_str = str(val).strip()
                        if '_' in v_str and '반' in v_str:
                            m = regex.match(v_str)
                            if m:
                                groups.append({
                                    'grade': grade,
                                    'group': m.group(1),
                                    'subject': m.group(2).strip(),
                                    'class_col': m.group(3).strip()
                                })
        except:
            pass
            
    unique_groups = []
    seen = set()
    for g in groups:
        t = (g['grade'], g['group'], g['subject'], g['class_col'])
        if t not in seen:
            seen.add(t)
            unique_groups.append(g)
            
    return unique_groups

def parse_students(filepaths):
    students = []
    regex = re.compile(r'^([A-Z][0-9]?)_(.+)_([0-9]+)반$')
    
    for grade, filepath in filepaths:
        if not filepath: continue
        try:
            xls = pd.ExcelFile(filepath)
            target_sheet = None
            for sheet in xls.sheet_names:
                if '학생' in sheet:
                    target_sheet = sheet
                    break
            if not target_sheet: continue
            
            df = pd.read_excel(xls, sheet_name=target_sheet)
            
            header_row = 0
            for i in range(min(5, len(df))):
                row_vals = [str(x).strip() for x in df.iloc[i].values]
                if '학번' in row_vals and ('성명' in row_vals or '이름' in row_vals):
                    header_row = i
                    break
            
            id_col, name_col = -1, -1
            row_vals = [str(x).strip() for x in df.iloc[header_row].values]
            for c, val in enumerate(row_vals):
                if '학번' in val and '이전' not in val: id_col = c
                if '성명' in val or '이름' in val: name_col = c
                
            for i in range(header_row + 1, len(df)):
                st_id = str(df.iloc[i, id_col]).strip() if id_col != -1 else ""
                if not st_id or st_id == 'nan' or not st_id.isdigit(): continue
                
                st_name = str(df.iloc[i, name_col]).strip() if name_col != -1 else ""
                
                try:
                    cls_col = str(int(st_id[1:3]))
                except:
                    cls_col = "1"
                    
                selections = []
                for c in range(len(df.columns)):
                    if c == id_col or c == name_col: continue
                    val = str(df.iloc[i, c]).strip()
                    if regex.match(val):
                        selections.append(val)
                        
                students.append({
                    'grade': grade,
                    'class_col': cls_col,
                    'student_id': st_id,
                    'name': st_name,
                    'selections': selections
                })
        except:
            pass
    return students

def run_diagnostic_solver(homeroom_classes, blocks, teachers, grades_classes, timeslots):
    from ortools.sat.python import cp_model
    model = cp_model.CpModel()
    
    x = {}
    for i, hc in enumerate(homeroom_classes):
        for ts in timeslots:
            x[f"HR_{i}", ts] = model.NewBoolVar(f"HR_{i}_{ts}")
    for b_key, block in blocks.items():
        for ts in timeslots:
            x[b_key, ts] = model.NewBoolVar(f"{b_key}_{ts}")
            
    for i, hc in enumerate(homeroom_classes):
        model.Add(sum(x[f"HR_{i}", ts] for ts in timeslots) == hc['hours'])
    for b_key, block in blocks.items():
        model.Add(sum(x[b_key, ts] for ts in timeslots) == block['hours'])
        
    penalties = []
    overlap_vars_t = {}
    
    for teacher in teachers:
        for ts in timeslots:
            teacher_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['teacher'] == teacher:
                    teacher_vars.append(x[f"HR_{i}", ts])
            for b_key, block in blocks.items():
                for c in block['classes']:
                    if c['teacher'] == teacher:
                        teacher_vars.append(x[b_key, ts])
            if len(teacher_vars) > 1:
                ov = model.NewIntVar(0, 10, f"ov_t_{teacher}_{ts}")
                model.Add(sum(teacher_vars) - 1 <= ov)
                overlap_vars_t[(teacher, ts)] = ov
                penalties.append(ov)
                
    overlap_vars_c = {}
    for grade, cls in grades_classes:
        for ts in timeslots:
            class_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['grade'] == grade and hc['class_col'] == cls:
                    class_vars.append(x[f"HR_{i}", ts])
            for b_key, block in blocks.items():
                if block['grade'] == grade:
                    class_vars.append(x[b_key, ts])
            if len(class_vars) > 1:
                ov = model.NewIntVar(0, 10, f"ov_c_{grade}_{cls}_{ts}")
                model.Add(sum(class_vars) - 1 <= ov)
                overlap_vars_c[(grade, cls, ts)] = ov
                penalties.append(ov)
                
    model.Minimize(sum(penalties))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0
    status = solver.Solve(model)
    
    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        bottleneck_msgs = []
        for (teacher, ts), ov_var in overlap_vars_t.items():
            if solver.Value(ov_var) > 0:
                day, period = ts.split('_')
                bottleneck_msgs.append(f"👨‍🏫 교사 동선 충돌: [{teacher}] 선생님이 {day}요일 {period}교시에 2개 이상의 수업을 진행해야만 시간표가 완성됩니다. (해당 교사의 시수를 감축하거나 이동그룹을 분산하세요)")
                
        for (grade, cls, ts), ov_var in overlap_vars_c.items():
            if solver.Value(ov_var) > 0:
                day, period = ts.split('_')
                bottleneck_msgs.append(f"🏫 학급 동선 충돌: [{grade}학년 {cls}반]의 수업이 {day}요일 {period}교시에 겹칩니다. (이동그룹 배치 변경 또는 공통과목 시간 이동 필요)")
                
        if bottleneck_msgs:
            unique_msgs = list(set(bottleneck_msgs))
            msg = "🚨 시간표 생성 병목 지점 발견!\n\n" + "\n\n".join(unique_msgs[:5])
            if len(unique_msgs) > 5:
                msg += f"\n\n...외 {len(unique_msgs)-5}건의 숨겨진 충돌이 더 있습니다."
            return {"status": "error", "message": msg}
            
    return {"status": "error", "message": "시간표 생성이 불가능합니다. 복합적인 동선 충돌이 발생했습니다. 여러 교사의 시수와 이동그룹을 전체적으로 점검해주세요."}

def run_solver(teacher_records, moving_groups, periods_config):
    from ortools.sat.python import cp_model
    model = cp_model.CpModel()
    
    days = list(periods_config.keys())
    timeslots = []
    for d in days:
        for p in range(1, periods_config[d] + 1):
            timeslots.append(f"{d}_{p}")
            
    total_timeslots = len(timeslots)
    
    blocks = {}
    used_teacher_records = set()
    
    for mg in moving_groups:
        grade = mg['grade']
        grp = mg['group']
        sub = mg['subject']
        cls = mg['class_col']
        
        match = None
        match_idx = -1
        
        def is_subject_match(s1, s2):
            s1 = s1.replace(" ", "")
            s2 = s2.replace(" ", "")
            if s1 == s2:
                return True
                
            abbr_map = {
                "사문": "사회와문화", "한지": "한국지리", "세지": "세계지리",
                "동사": "동아시아사", "생윤": "생활과윤리", "윤사": "윤리와사상",
                "정법": "정치와법", "물1": "물리학1", "물2": "물리학2",
                "화1": "화학1", "화2": "화학2", "생1": "생명과학1", "생2": "생명과학2",
                "지1": "지구과학1", "지2": "지구과학2", "화작": "화법과작문",
                "언매": "언어와매체", "확통": "확률과통계", "미적": "미적분",
                "고전": "고전문학"
            }
            
            full_s1 = abbr_map.get(s1, s1)
            full_s2 = abbr_map.get(s2, s2)
            
            if full_s1 == full_s2:
                return True
                
            if len(full_s1) > 2 and len(full_s2) > 2:
                if full_s1 in full_s2 or full_s2 in full_s1:
                    return True
            else:
                if (full_s1 in full_s2 or full_s2 in full_s1) and abs(len(full_s1) - len(full_s2)) <= 1:
                    return True
            return False

        for i, tr in enumerate(teacher_records):
            if tr['grade'] == grade and str(tr['class_col']) == cls and is_subject_match(sub, tr['subject']):
                match = tr
                match_idx = i
                break
                
        if match:
            b_key = f"G{grade}_Group_{grp}"
            if b_key not in blocks:
                blocks[b_key] = {
                    'grade': grade,
                    'group': grp,
                    'hours': match['hours'],
                    'classes': []
                }
            blocks[b_key]['classes'].append({
                'teacher': match['teacher'],
                'subject': match['subject'],
                'class_col': cls
            })
            used_teacher_records.add(match_idx)

    homeroom_classes = []
    for i, tr in enumerate(teacher_records):
        if i not in used_teacher_records:
            homeroom_classes.append({
                'grade': tr['grade'],
                'class_col': str(tr['class_col']),
                'teacher': tr['teacher'],
                'subject': tr['subject'],
                'hours': tr['hours']
            })
            
    teachers = set([tr['teacher'] for tr in teacher_records])
    teacher_demands = {t: 0 for t in teachers}
    for hc in homeroom_classes:
        teacher_demands[hc['teacher']] += hc['hours']
    for b_key, block in blocks.items():
        for c in block['classes']:
            teacher_demands[c['teacher']] += block['hours']
            
    for t, hours in teacher_demands.items():
        if hours > total_timeslots:
            return {"status": "error", "message": f"시간표 생성 불가: '{t}' 교사의 주당 배정 시간({hours}시간)이 총 가능 시간({total_timeslots}시간)을 초과합니다. 담당 시수를 줄여야 합니다."}
            
    for b_key, block in blocks.items():
        t_counts = {}
        for c in block['classes']:
            t = c['teacher']
            t_counts[t] = t_counts.get(t, 0) + 1
            if t_counts[t] > 1:
                return {"status": "error", "message": f"시간표 생성 불가: '{t}' 교사가 {block['grade']}학년 이동그룹 {block['group']} 내에서 2개 이상의 과목/반을 동시에 담당하도록 배정되어 있습니다. 이동수업은 동시간대에 진행되므로 한 교사가 여러 반을 들어갈 수 없습니다. 이동그룹 편성을 변경하세요."}
                
    grades_classes = set([(tr['grade'], str(tr['class_col'])) for tr in teacher_records])
    class_demands = {gc: 0 for gc in grades_classes}
    for hc in homeroom_classes:
        class_demands[(hc['grade'], hc['class_col'])] += hc['hours']
    for b_key, block in blocks.items():
        grade = block['grade']
        for c in block['classes']:
            class_demands[(grade, c['class_col'])] += block['hours']
            
    for gc, hours in class_demands.items():
        if hours > total_timeslots:
            return {"status": "error", "message": f"시간표 생성 불가: {gc[0]}학년 {gc[1]}반의 주당 총 배정 시간({hours}시간)이 총 가능 시간({total_timeslots}시간)을 초과합니다."}

    x = {}
    for i, hc in enumerate(homeroom_classes):
        for ts in timeslots:
            x[f"HR_{i}", ts] = model.NewBoolVar(f"HR_{i}_{ts}")
    for b_key, block in blocks.items():
        for ts in timeslots:
            x[b_key, ts] = model.NewBoolVar(f"{b_key}_{ts}")
            
    for i, hc in enumerate(homeroom_classes):
        model.Add(sum(x[f"HR_{i}", ts] for ts in timeslots) == hc['hours'])
    for b_key, block in blocks.items():
        model.Add(sum(x[b_key, ts] for ts in timeslots) == block['hours'])
        
    for teacher in teachers:
        for ts in timeslots:
            teacher_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['teacher'] == teacher:
                    teacher_vars.append(x[f"HR_{i}", ts])
            for b_key, block in blocks.items():
                for c in block['classes']:
                    if c['teacher'] == teacher:
                        teacher_vars.append(x[b_key, ts])
            if teacher_vars:
                model.AddAtMostOne(teacher_vars)
                
    for grade, cls in grades_classes:
        for ts in timeslots:
            class_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['grade'] == grade and hc['class_col'] == cls:
                    class_vars.append(x[f"HR_{i}", ts])
            for b_key, block in blocks.items():
                if block['grade'] == grade:
                    class_vars.append(x[b_key, ts])
            if class_vars:
                model.AddAtMostOne(class_vars)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60.0
    status = solver.Solve(model)
    
    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        schedule = []
        for i, hc in enumerate(homeroom_classes):
            for ts in timeslots:
                if solver.Value(x[f"HR_{i}", ts]):
                    day, period = ts.split('_')
                    schedule.append({
                        'type': 'homeroom',
                        'grade': hc['grade'],
                        'class_col': hc['class_col'],
                        'teacher': hc['teacher'],
                        'subject': hc['subject'],
                        'day': day,
                        'period': int(period)
                    })
        for b_key, block in blocks.items():
            for ts in timeslots:
                if solver.Value(x[b_key, ts]):
                    day, period = ts.split('_')
                    for c in block['classes']:
                        schedule.append({
                            'type': 'moving_group',
                            'grade': block['grade'],
                            'group': block['group'],
                            'class_col': c['class_col'],
                            'teacher': c['teacher'],
                            'subject': c['subject'],
                            'day': day,
                            'period': int(period)
                        })
        return {"status": "success", "schedule": schedule}
    else:
        # Diagnostic mode
        return run_diagnostic_solver(homeroom_classes, blocks, teachers, grades_classes, timeslots)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No input JSON provided"}))
        return

    try:
        input_data = json.loads(sys.argv[1])
        teacher_file = input_data.get('teacher_file')
        g2_file = input_data.get('g2_file')
        g3_file = input_data.get('g3_file')
        periods = input_data.get('periods', {"월": 7, "화": 7, "수": 6, "목": 7, "금": 6})
        
        teacher_records = parse_teacher_workload(teacher_file)
        moving_groups = parse_moving_groups([(2, g2_file), (3, g3_file)])
        
        students = parse_students([(2, g2_file), (3, g3_file)])
        
        result = run_solver(teacher_records, moving_groups, periods)
        
        if result["status"] == "success":
            result["students"] = students
            
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"status": "error", "message": f"시스템 오류: {str(e)}\n{traceback.format_exc()}"}))

if __name__ == "__main__":
    main()
