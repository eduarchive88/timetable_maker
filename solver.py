import sys
import json
import pandas as pd
import re
import traceback
import math

def parse_teacher_workload(filepath):
    # This function needs to parse the complex header.
    # Typical header: 
    # Row 0: 1학년 (merged), 2학년 (merged), 3학년 (merged), 계
    # Row 1: 1, 2, 3, 4 ... 1, 2, 3...
    
    df = pd.read_excel(filepath, header=None)
    # Find the row that contains '교사명' or '1학년'
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
    
    # Identify column indices for each Grade and Class
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
                # val1 should be class number
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
    # Extracts moving groups like A_사회와 문화_1반
    groups = [] # { grade, group_id, subject, class_col }
    
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
                                grp = m.group(1)
                                sub = m.group(2)
                                cls = m.group(3)
                                groups.append({
                                    'grade': grade,
                                    'group': grp,
                                    'subject': sub.strip(),
                                    'class_col': cls.strip()
                                })
        except Exception as e:
            print(f"Warning parsing {filepath}: {e}")
            
    # remove duplicates
    unique_groups = []
    seen = set()
    for g in groups:
        t = (g['grade'], g['group'], g['subject'], g['class_col'])
        if t not in seen:
            seen.add(t)
            unique_groups.append(g)
            
    return unique_groups

def run_solver(teacher_records, moving_groups, periods_config):
    from ortools.sat.python import cp_model
    
    model = cp_model.CpModel()
    
    # Days and periods
    days = list(periods_config.keys())
    timeslots = []
    for d in days:
        for p in range(1, periods_config[d] + 1):
            timeslots.append(f"{d}_{p}")
            
    total_timeslots = len(timeslots)
    
    # Blocks mapping
    blocks = {}
    used_teacher_records = set()
    
    for mg in moving_groups:
        grade = mg['grade']
        grp = mg['group']
        sub = mg['subject']
        cls = mg['class_col']
        
        match = None
        match_idx = -1
        
        # Helper for fuzzy matching
        def is_subject_match(s1, s2):
            s1 = s1.replace(" ", "")
            s2 = s2.replace(" ", "")
            if s1 == s2 or s1 in s2 or s2 in s1:
                return True
            # Check for acronym matching (e.g. 사문 == 사회와문화)
            if len(s1) == 2 and len(s2) > 2:
                if s1[0] in s2 and s1[1] in s2 and s2.find(s1[0]) < s2.find(s1[1]):
                    return True
            if len(s2) == 2 and len(s1) > 2:
                if s2[0] in s1 and s2[1] in s1 and s1.find(s2[0]) < s1.find(s2[1]):
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
            
    # VALIDATION CHECKS
    # 1. Teacher total hours
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
            
    # 2. Teacher conflict in the SAME moving block
    for b_key, block in blocks.items():
        t_counts = {}
        for c in block['classes']:
            t = c['teacher']
            t_counts[t] = t_counts.get(t, 0) + 1
            if t_counts[t] > 1:
                return {"status": "error", "message": f"시간표 생성 불가: '{t}' 교사가 {block['grade']}학년 이동그룹 {block['group']} 내에서 2개 이상의 과목/반을 동시에 담당하도록 배정되어 있습니다. 이동수업은 동시간대에 진행되므로 한 교사가 여러 반을 들어갈 수 없습니다. 이동그룹 편성을 변경하세요."}
                
    # 3. Class total hours
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

    # CREATE VARIABLES
    x = {}
    for i, hc in enumerate(homeroom_classes):
        for ts in timeslots:
            x[f"HR_{i}", ts] = model.NewBoolVar(f"HR_{i}_{ts}")
    for b_key, block in blocks.items():
        for ts in timeslots:
            x[b_key, ts] = model.NewBoolVar(f"{b_key}_{ts}")
            
    # CONSTRAINTS
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
                    # Does this block actually contain this class_col?
                    # If the moving group involves this class, it blocks it. 
                    # Wait, do ALL classes in the grade get blocked by ANY moving group of that grade?
                    # Let's assume yes, the entire grade runs the moving group simultaneously.
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
        # If still infeasible after explicit checks, it's likely a hidden conflict (like graph coloring issue)
        return {"status": "error", "message": "시간표 생성이 불가능합니다. 명시적인 초과 시간은 없으나, 교사들의 동선이 겹쳐서 남은 빈 시간에 배치할 수 없는 숨겨진 병목이 존재합니다. 일부 교사의 시수를 조정하거나 이동그룹을 재배치해보세요."}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No input JSON provided"}))
        return

    try:
        input_data = json.loads(sys.argv[1])
        teacher_file = input_data.get('teacher_file')
        g2_file = input_data.get('g2_file')
        g3_file = input_data.get('g3_file')
        group_file = input_data.get('group_file') # Currently not deeply used if we rely on 학급편성 strings
        periods = input_data.get('periods', {"월": 7, "화": 7, "수": 6, "목": 7, "금": 6})
        
        teacher_records = parse_teacher_workload(teacher_file)
        
        # We extract moving groups from g2_file and g3_file
        moving_groups = parse_moving_groups([
            (2, g2_file),
            (3, g3_file)
        ])
        
        result = run_solver(teacher_records, moving_groups, periods)
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"status": "error", "message": f"시스템 오류: {str(e)}"}))

if __name__ == "__main__":
    main()
