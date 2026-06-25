import sys
import json
import pandas as pd
import re
import traceback

# 한글 깨짐 방지 (Windows 환경 등에서 표준 출력 인코딩을 UTF-8로 강제)
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# ──────────────────────────────────────────
# 교사별 시수표 파싱
# ──────────────────────────────────────────
def parse_teacher_workload(filepath):
    """교사별 시수표 엑셀 파일을 파싱하여 레코드 리스트로 변환"""
    df = pd.read_excel(filepath, header=None)
    header_row_idx = -1
    for i in range(len(df)):
        row_vals = [str(x).strip() for x in df.iloc[i].values]
        if '1학년' in row_vals or '교사명' in row_vals or '단축과목명' in row_vals:
            header_row_idx = i
            break
            
    if header_row_idx == -1:
        raise Exception("교사별 시수표 파일에서 헤더 행을 찾을 수 없습니다. (1학년/교사명/단축과목명 포함 행 필요)")
        
    row0 = df.iloc[header_row_idx].ffill().values
    row1 = df.iloc[header_row_idx+1].values
    
    grade_class_cols = []
    teacher_col = -1
    subject_col = -1
    
    for c in range(len(row0)):
        val0 = str(row0[c]).strip()
        val1 = str(row1[c]).strip()
        
        # 교사명 컬럼 찾기
        if '교사명' in val0 or '교사명' in val1:
            teacher_col = c
        # 과목명 컬럼 찾기 (정식과목명 우선, 없으면 단축과목명)
        elif '정식과목명' in val0 or '정식과목명' in val1:
            subject_col = c
        elif '단축과목명' in val0 or '단축과목명' in val1:
            if subject_col == -1: subject_col = c
            
        # 학년-반 컬럼 찾기
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
        
        # 빈 행 스킵
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


# ──────────────────────────────────────────
# 이동그룹 파싱 (이동그룹 엑셀 파일 전용)
# ──────────────────────────────────────────
def parse_moving_groups(group_filepath, target_semester=0):
    """
    이동그룹 엑셀 파일(매트릭스 형태)에서 그룹 정보를 추출.
    - 열 헤더 또는 특정 행에 '1반', '2반' 등 학급 정보가 있음
    - 행 앞쪽에 'A', 'B', 'C' 등 그룹명이 있음
    - 셀 내부에 '사회와 문화(33)'처럼 과목명이 있음
    """
    groups = []
    if not group_filepath:
        return groups
    
    try:
        xls = pd.ExcelFile(group_filepath)
        for sheet in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet)
            
            current_grade = None
            current_class_indices = {}
            last_seen_subject = {}  # {(grade, class_col, base_grp): subject}
            
            # 1. 컬럼명에서 학년 및 반 정보 추출 시도
            for c_idx, col in enumerate(df.columns):
                c_str = str(col).strip()
                if '학년' in c_str:
                    gm = re.search(r'([1-3])\s*학년', c_str)
                    if gm: current_grade = int(gm.group(1))
                cm = re.search(r'([0-9]+)\s*반', c_str)
                if cm:
                    current_class_indices[c_idx] = cm.group(1)
                    
            # 2. 행을 반복하며 파싱
            for row_idx in range(len(df)):
                row = df.iloc[row_idx]
                row_vals_str = [str(x).strip() for x in row.values]
                
                # 행에서 학년 정보가 나오면 업데이트 (ex: '3학년')
                val0 = str(row.iloc[0]).strip()
                if '학년' in val0:
                    gm = re.search(r'([1-3])\s*학년', val0)
                    if gm: current_grade = int(gm.group(1))
                    
                # 행에서 반 정보가 나오면 인덱스 매핑 업데이트 (헤더 행)
                if any('1반' in x for x in row_vals_str) or any('2반' in x for x in row_vals_str):
                    current_class_indices = {}
                    for c_idx, val in enumerate(row_vals_str):
                        cm = re.search(r'([0-9]+)\s*반', val)
                        if cm:
                            current_class_indices[c_idx] = cm.group(1)
                    continue
                    
                # 학기 정보 추출
                val0 = str(row.iloc[0]).replace('\n', '').replace(' ', '')
                val1 = ''
                if len(row.values) > 1:
                    val1 = str(row.iloc[1]).replace('\n', '').replace(' ', '')
                
                sm = re.search(r'([12])학기', val0)
                if not sm:
                    sm = re.search(r'([12])학기', val1)
                
                row_semester = int(sm.group(1)) if sm else None
                
                # 타겟 학기가 명시되어 있고(1,2), 현재 행의 학기가 파악되었으며 다를 경우 스킵
                if target_semester and target_semester != 0 and row_semester and row_semester != target_semester:
                    continue

                # 그룹명 추출 (보통 2번째 또는 3번째 컬럼에 A, B, C 존재)
                group_name = None
                for c_idx in range(min(4, len(row.values))):
                    val = str(row.iloc[c_idx]).strip()
                    # A, B1, B2, C 등을 인식
                    if re.match(r'^[A-Z][0-9]?$', val):
                        group_name = val
                        break
                        
                if group_name and current_grade and current_class_indices:
                    for c_idx, class_col in current_class_indices.items():
                        cell_val = str(row.iloc[c_idx]).strip()
                        base_grp = group_name[0] if group_name else None
                        
                        if cell_val and cell_val != 'nan':
                            # "사회와 문화(33)" -> 1학기: "사회와 문화", 2학기: "사회와 문화"
                            # "언어와매체(현대문학감상)" -> 1학기: "언어와매체", 2학기: "현대문학감상"
                            # "화법과작문(고전읽기)(33)" -> 1학기: "화법과작문", 2학기: "고전읽기"
                            sub_m = re.match(r'^([^\(]+)(?:\(([^\(0-9]+)\))?(?:\(([0-9]+)\))?', cell_val)
                            if sub_m:
                                sub1 = sub_m.group(1).strip()
                                sub2 = sub_m.group(2).strip() if sub_m.group(2) else sub1
                                
                                subject = sub2 if target_semester == 2 else sub1
                                
                                if subject:
                                    last_seen_subject[(current_grade, class_col, base_grp)] = subject
                                    groups.append({
                                        'grade': current_grade,
                                        'group': group_name,
                                        'subject': subject,
                                        'class_col': class_col
                                    })
                        else:
                            # 만약 값이 비어있다면, 동일한 base_grp(예: B1 -> B2)에서 병합된 셀일 가능성이 높으므로 이전 값을 상속받음
                            if base_grp and (current_grade, class_col, base_grp) in last_seen_subject:
                                subject = last_seen_subject[(current_grade, class_col, base_grp)]
                                groups.append({
                                    'grade': current_grade,
                                    'group': group_name,
                                    'subject': subject,
                                    'class_col': class_col
                                })
    except Exception as e:
        raise Exception(f"이동그룹 파일 파싱 오류: {str(e)}")
            
    # 중복 제거 (학년-그룹-과목-반)
    unique_groups = []
    seen = set()
    for g in groups:
        t = (g['grade'], g['group'], g['subject'], g['class_col'])
        if t not in seen:
            seen.add(t)
            unique_groups.append(g)
            
    return unique_groups


# ──────────────────────────────────────────
# 과목명 매칭 유틸리티
# ──────────────────────────────────────────
def is_subject_match(s1, s2):
    """두 과목명이 같은 과목인지 판단 (약어 매핑 포함)"""
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
        "고전": "고전문학", "세사": "세계사", "한사": "한국사",
        "경제": "경제", "여지": "여행지리",
        "물리": "물리학", "화학": "화학", "생명": "생명과학", "지구": "지구과학",
    }
    
    full_s1 = abbr_map.get(s1, s1)
    full_s2 = abbr_map.get(s2, s2)
    
    if full_s1 == full_s2:
        return True
        
    # 부분 문자열 매칭 (긴 이름끼리)
    if len(full_s1) > 2 and len(full_s2) > 2:
        if full_s1 in full_s2 or full_s2 in full_s1:
            return True
    else:
        if (full_s1 in full_s2 or full_s2 in full_s1) and abs(len(full_s1) - len(full_s2)) <= 1:
            return True
    return False


# ──────────────────────────────────────────
# 교사 시수표 + 이동그룹 → 데이터 준비
# ──────────────────────────────────────────
def prepare_solver_data(teacher_records, moving_groups):
    """
    교사 시수표 레코드와 이동그룹 정보를 결합하여
    homeroom_classes(공통수업)와 blocks(이동수업)로 분리
    
    서브그룹 시수 보정 로직:
    - B1, B2 처럼 서브그룹이 존재할 경우, 공통(B) 과목과 전용(B1/B2) 과목의 시수가 다름
    - B1 전용 과목의 시수 → B1 블록의 시수
    - B2 전용 과목의 시수 → B2 블록의 시수  
    - 공통(B) 과목 총 시수 = B1 시수 + B2 시수
    """
    blocks = {}
    used_teacher_records = set()
    
    for mg in moving_groups:
        grade = mg['grade']
        grp = mg['group']
        sub = mg['subject']
        cls = mg['class_col']
        
        # 이동그룹의 과목·반에 매칭되는 교사 시수 레코드 찾기
        match = None
        match_idx = -1
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
                    'subject': match['subject'],
                    'classes': []
                }
            blocks[b_key]['classes'].append({
                'teacher': match['teacher'],
                'subject': match['subject'],
                'class_col': cls,
                'hours': match['hours']  # 개별 과목 시수도 보존
            })
            used_teacher_records.add(match_idx)
    
    # ── 서브그룹(B1, B2 등) 시수 보정 ──
    # B1, B2 등 서브그룹이 존재할 때, 각 블록의 hours를 전용 과목 시수로 보정
    # 공통 과목은 양쪽에 모두 나타나므로 B1.hours + B2.hours = 공통 과목 총 시수
    subgroup_map = {}  # (grade, base_letter) → [b_key1, b_key2, ...]
    for b_key, block in blocks.items():
        grp = block['group']
        m = re.match(r'^([A-Z])(\d+)$', grp)
        if m:
            base_letter = m.group(1)
            key = (block['grade'], base_letter)
            if key not in subgroup_map:
                subgroup_map[key] = []
            subgroup_map[key].append(b_key)
    
    for (grade, base_letter), sub_keys in subgroup_map.items():
        if len(sub_keys) < 2:
            continue  # 서브그룹이 1개면 보정 불필요
            
        # 모든 서브그룹에 공통으로 나타나는 과목·반 조합 찾기
        class_sets = []
        for sk in sub_keys:
            cs = set()
            for c in blocks[sk]['classes']:
                cs.add((c['class_col'], c['subject']))
            class_sets.append(cs)
        
        common_classes = class_sets[0]
        for cs in class_sets[1:]:
            common_classes = common_classes & cs
        
        # 각 서브그룹의 전용(exclusive) 과목 시수로 블록 시수 결정
        for sk in sub_keys:
            exclusive_hours = []
            for c in blocks[sk]['classes']:
                if (c['class_col'], c['subject']) not in common_classes:
                    exclusive_hours.append(c['hours'])
            
            if exclusive_hours:
                # 전용 과목 중 가장 많이 등장하는 시수를 블록 시수로 결정
                from collections import Counter
                hour_counts = Counter(exclusive_hours)
                new_hours = hour_counts.most_common(1)[0][0]
                blocks[sk]['hours'] = new_hours
    
    # 이동그룹에 매칭되지 않은 레코드 → 공통수업(homeroom)
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
    
    # 교사 목록
    teachers = set([tr['teacher'] for tr in teacher_records])
    # 학급 목록
    grades_classes = set([(tr['grade'], str(tr['class_col'])) for tr in teacher_records])
    
    # 학급별 총 시수 계산
    # 서브그룹(B1, B2)에 공통으로 등장하는 학급은 시수를 중복 합산하지 않도록 주의
    # B1(2h) + B2(1h)에 공통 등장하는 학급의 이동수업 시수 = 원래 시수표의 시수(3h)
    homeroom_demands = {}
    for hc in homeroom_classes:
        k = (hc['grade'], hc['class_col'])
        homeroom_demands[k] = homeroom_demands.get(k, 0) + hc['hours']
    
    # 이동그룹 시수: 학급별로 해당 학급의 원래 시수(teacher_record)를 사용
    # 같은 base 그룹(B1, B2)에 중복 등장하는 학급은 한 번만 카운트
    block_hours_by_class = {}  # (grade, cls, base_letter) → 이미 카운트한 시수
    for b_key, block in blocks.items():
        grp = block['group']
        m_sub = re.match(r'^([A-Z])\d+$', grp)
        base_letter = m_sub.group(1) if m_sub else grp
        
        for c in block['classes']:
            cls = str(c['class_col'])
            k = (block['grade'], cls)
            base_key = (block['grade'], cls, base_letter)
            
            # 이 학급의 원래 시수 (teacher_record에서 가져온 값)
            original_hours = c.get('hours', block['hours'])
            
            if base_key not in block_hours_by_class:
                # 아직 카운트하지 않은 base 그룹의 학급 → 원래 시수로 카운트
                block_hours_by_class[base_key] = original_hours
                homeroom_demands[k] = homeroom_demands.get(k, 0) + original_hours
            # 이미 카운트된 경우(B1에서 카운트 후 B2에서 중복) → 스킵
    
    return homeroom_classes, blocks, teachers, grades_classes, homeroom_demands


# ──────────────────────────────────────────
# 진단용 Solver (충돌 허용, 최소화)
# ──────────────────────────────────────────
def run_diagnostic_solver(homeroom_classes, blocks, teachers, grades_classes, timeslots, days, periods_config, homeroom_demands, fixed_timeslots=[], advanced_options={}):
    """시간표 생성이 불가능할 때, 충돌을 허용하며 최소화하는 진단 모드"""
    from ortools.sat.python import cp_model
    model = cp_model.CpModel()
    
    avoid_block = advanced_options.get('avoid_block_classes', True)
    x = {}
    for i, hc in enumerate(homeroom_classes):
        for ts in timeslots:
            x[f"HR_{i}", ts] = model.NewBoolVar(f"HR_{i}_{ts}")
    for b_key, block in blocks.items():
        for ts in timeslots:
            x[b_key, ts] = model.NewBoolVar(f"{b_key}_{ts}")
            
    # 시수 제약: 각 수업은 정확히 배정된 시수만큼 배치
    for i, hc in enumerate(homeroom_classes):
        model.Add(sum(x[f"HR_{i}", ts] for ts in timeslots) == hc['hours'])
    for b_key, block in blocks.items():
        model.Add(sum(x[b_key, ts] for ts in timeslots) == block['hours'])
        
    # 교사 겹침 패널티 (소프트 제약)
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
                
    # 학급 겹침 패널티 (소프트 제약)
    overlap_vars_c = {}
    for grade, cls in grades_classes:
        for ts in timeslots:
            class_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['grade'] == grade and hc['class_col'] == cls:
                    class_vars.append(x[f"HR_{i}", ts])
            for b_key, block in blocks.items():
                if block['grade'] == grade:
                    for c_dict in block['classes']:
                        if c_dict['class_col'] == cls:
                            class_vars.append(x[b_key, ts])
                            break
            if len(class_vars) > 1:
                ov = model.NewIntVar(0, 10, f"ov_c_{grade}_{cls}_{ts}")
                model.Add(sum(class_vars) - 1 <= ov)
                overlap_vars_c[(grade, cls, ts)] = ov
                penalties.append(ov)
                
    # 서브그룹 (B1, B2 등) 동시간대 진행 불가 (하드 제약)
    subgroup_vars_by_base_day = {}
    for b_key, block in blocks.items():
        grade = block['grade']
        grp = block['group']
        m_sub = re.match(r'^([A-Z])\d+$', grp)
        if m_sub:
            base_grp = m_sub.group(1)
            for ts in timeslots:
                key = (grade, base_grp, ts)
                if key not in subgroup_vars_by_base_day:
                    subgroup_vars_by_base_day[key] = []
                subgroup_vars_by_base_day[key].append(x[b_key, ts])
                
    for key, var_list in subgroup_vars_by_base_day.items():
        if len(var_list) > 1:
            model.AddAtMostOne(var_list)
            
    # 제약 6 (소프트): 같은 base 그룹(C1, C2 등) 이동수업은 가급적 다른 요일에 배치
    subgroup_day_vars = {}
    for b_key, block in blocks.items():
        grade = block['grade']
        grp = block['group']
        m_sub = re.match(r'^([A-Z])\d+$', grp)
        if m_sub:
            base_grp = m_sub.group(1)
            for ts in timeslots:
                day, _ = ts.split('_')
                key = (grade, base_grp, day)
                if key not in subgroup_day_vars:
                    subgroup_day_vars[key] = {}
                if b_key not in subgroup_day_vars[key]:
                    subgroup_day_vars[key][b_key] = []
                subgroup_day_vars[key][b_key].append(x[b_key, ts])
                
    for (grade, base_grp, day), bkey_vars in subgroup_day_vars.items():
        if len(bkey_vars) < 2:
            continue
        subgrp_on_day = []
        for b_key, var_list in bkey_vars.items():
            is_on_day = model.NewBoolVar(f"diag_sgrp_day_{grade}_{base_grp}_{day}_{b_key}")
            model.AddMaxEquality(is_on_day, var_list)
            subgrp_on_day.append(is_on_day)
        if len(subgrp_on_day) >= 2:
            same_day_count = model.NewIntVar(0, len(subgrp_on_day), f"diag_same_day_{grade}_{base_grp}_{day}")
            model.Add(same_day_count == sum(subgrp_on_day))
            overflow = model.NewIntVar(0, len(subgrp_on_day), f"diag_overflow_{grade}_{base_grp}_{day}")
            model.Add(overflow >= same_day_count - 1)
            model.Add(overflow >= 0)
            penalties.append(overflow * 80)

    # 제약 4 (소프트): 같은 과목 하루 최대 1회 (블록타임 금지)
    import math
    subject_total_hours = {}
    for i, hc in enumerate(homeroom_classes):
        g, c, sub = hc['grade'], hc['class_col'], hc['subject']
        subject_total_hours[(g, c, sub)] = subject_total_hours.get((g, c, sub), 0) + hc['hours']
    for b_key, block in blocks.items():
        g = block['grade']
        for c_dict in block['classes']:
            c_col = c_dict['class_col']
            sub = c_dict['subject']
            subject_total_hours[(g, c_col, sub)] = subject_total_hours.get((g, c_col, sub), 0) + block['hours']

    subject_vars_by_class_day = {}
    for i, hc in enumerate(homeroom_classes):
        g, c, sub = hc['grade'], hc['class_col'], hc['subject']
        for ts in timeslots:
            day, _ = ts.split('_')
            key = (g, c, sub, day)
            if key not in subject_vars_by_class_day:
                subject_vars_by_class_day[key] = {}
            subject_vars_by_class_day[key][f"HR_{i}_{ts}"] = x[f"HR_{i}", ts]

    for b_key, block in blocks.items():
        g = block['grade']
        for c_dict in block['classes']:
            c_col = c_dict['class_col']
            sub = c_dict['subject']
            for ts in timeslots:
                day, _ = ts.split('_')
                key = (g, c_col, sub, day)
                if key not in subject_vars_by_class_day:
                    subject_vars_by_class_day[key] = {}
                subject_vars_by_class_day[key][f"{b_key}_{ts}"] = x[b_key, ts]

    for key, var_dict in subject_vars_by_class_day.items():
        g, c, sub, day = key
        var_list = list(var_dict.values())
        if not var_list:
            continue
        total_h = subject_total_hours.get((g, c, sub), 0)
        
        if avoid_block:
            hard_limit = 1
        else:
            hard_limit = max(2, math.ceil(total_h / len(days)))
            
        if len(var_list) > hard_limit:
            block_ov = model.NewIntVar(0, 10, f"diag_block_ov_{g}_{c}_{sub}_{day}")
            model.Add(sum(var_list) - hard_limit <= block_ov)
            penalties.append(block_ov * 1000)
    # 1~6교시 최소 배정 (시수가 충분한 반만)
    min_required_hours_base = sum(min(6, periods_config[d]) for d in days)
    fixed_in_1_6 = sum(1 for ts in fixed_timeslots if int(ts.split('_')[1]) <= 6)
    min_required_hours = min_required_hours_base - fixed_in_1_6

    for grade, cls in grades_classes:
        for ts in timeslots:
            d, p_str = ts.split('_')
            p = int(p_str)
            
            class_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['grade'] == grade and hc['class_col'] == cls:
                    class_vars.append(x[f"HR_{i}", ts])
            for b_key, block in blocks.items():
                if block['grade'] == grade:
                    for c_dict in block['classes']:
                        if c_dict['class_col'] == cls:
                            class_vars.append(x[b_key, ts])
                            break
                            
            if class_vars:
                total_h = homeroom_demands.get((grade, cls), 0)
                is_real_class = total_h > 0
                is_fixed = ts in fixed_timeslots
                
                if is_fixed:
                    model.Add(sum(class_vars) == 0)
                elif p <= 6 and is_real_class and total_h >= min_required_hours:
                    model.Add(sum(class_vars) >= 1)
    
    # 충돌 최소화 목적함수
    model.Minimize(sum(penalties))
    
    # 휴리스틱: 이동그룹 먼저 배치
    block_vars = [x[b_key, ts] for b_key in blocks.keys() for ts in timeslots]
    if block_vars:
        model.AddDecisionStrategy(block_vars, cp_model.CHOOSE_FIRST, cp_model.SELECT_MIN_VALUE)
        
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60.0
    solver.parameters.num_search_workers = 8
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

        # 충돌 원인 분석
        bottleneck_msgs = []
        for (teacher, ts), ov_var in overlap_vars_t.items():
            if solver.Value(ov_var) > 0:
                day, period = ts.split('_')
                bottleneck_msgs.append(
                    f"👨‍🏫 교사 충돌: [{teacher}] 선생님이 {day}요일 {period}교시에 "
                    f"2개 이상의 수업을 동시에 진행해야 합니다. "
                    f"(해당 교사의 시수를 감축하거나 이동그룹을 분산하세요)"
                )
                
        for (grade, cls, ts), ov_var in overlap_vars_c.items():
            if solver.Value(ov_var) > 0:
                day, period = ts.split('_')
                bottleneck_msgs.append(
                    f"🏫 학급 충돌: [{grade}학년 {cls}반]의 수업이 {day}요일 {period}교시에 겹칩니다. "
                    f"(이동그룹 배치 변경 또는 공통과목 시간 이동 필요)"
                )
                
        if bottleneck_msgs:
            unique_msgs = list(set(bottleneck_msgs))
            unique_msgs.sort()
            msg = "🚨 시간표가 생성되었으나, 일부 충돌이 있습니다!\n\n" + "\n\n".join(unique_msgs)
            return {"status": "warning", "message": msg, "schedule": schedule}
            
        return {"status": "success", "schedule": schedule}
            
    return {"status": "error", "message": "시간표 생성이 불가능합니다. 교사 시수와 이동그룹을 전체적으로 점검해주세요."}


# ──────────────────────────────────────────
# 메인 Solver (충돌 불허)
# ──────────────────────────────────────────
def run_solver(teacher_records, moving_groups, periods_config, fixed_timeslots=[], advanced_options={}):
    """교사 시수표와 이동그룹으로 시간표를 생성하는 메인 함수"""
    from ortools.sat.python import cp_model
    model = cp_model.CpModel()
    
    # 타임슬롯 생성
    days = list(periods_config.keys())
    timeslots = []
    for d in days:
        for p in range(1, periods_config[d] + 1):
            timeslots.append(f"{d}_{p}")
    total_timeslots = len(timeslots)
    
    # 데이터 준비
    homeroom_classes, blocks, teachers, grades_classes, homeroom_demands = prepare_solver_data(teacher_records, moving_groups)
    
    # ── 사전 검증 ──
    
    # 교사 총 시수 검증
    teacher_demands = {t: 0 for t in teachers}
    for hc in homeroom_classes:
        teacher_demands[hc['teacher']] += hc['hours']
    for b_key, block in blocks.items():
        for c in block['classes']:
            teacher_demands[c['teacher']] += block['hours']
            
    for t, hours in teacher_demands.items():
        if hours > total_timeslots:
            return {"status": "error", "message": f"시간표 생성 불가: '{t}' 교사의 주당 배정 시간({hours}시간)이 총 가능 시간({total_timeslots}시간)을 초과합니다."}
            
    # 이동그룹 내 동일 교사 중복 배정 검증
    for b_key, block in blocks.items():
        t_counts = {}
        for c in block['classes']:
            t = c['teacher']
            t_counts[t] = t_counts.get(t, 0) + 1
            if t_counts[t] > 1:
                return {"status": "error", "message": (
                    f"시간표 생성 불가: '{t}' 교사가 {block['grade']}학년 이동그룹 {block['group']} 내에서 "
                    f"2개 이상의 반을 동시에 담당합니다. 이동수업은 동시간대에 진행되므로 "
                    f"한 교사가 여러 반을 들어갈 수 없습니다."
                )}
                
    # 학급 총 시수 초과 검증
    for k, total_h in homeroom_demands.items():
        if total_h > total_timeslots:
            return {"status": "error", "message": f"시간표 생성 불가: {k[0]}학년 {k[1]}반의 총 배정 시간({total_h}시간)이 가용 교시({total_timeslots}시간)를 초과합니다."}

    # ── CP-SAT 모델 구성 ──
    
    # 결정 변수 생성
    x = {}
    for i, hc in enumerate(homeroom_classes):
        for ts in timeslots:
            x[f"HR_{i}", ts] = model.NewBoolVar(f"HR_{i}_{ts}")
    for b_key, block in blocks.items():
        for ts in timeslots:
            x[b_key, ts] = model.NewBoolVar(f"{b_key}_{ts}")
            
    # 제약 1: 각 수업은 정확히 배정된 시수만큼 배치
    for i, hc in enumerate(homeroom_classes):
        model.Add(sum(x[f"HR_{i}", ts] for ts in timeslots) == hc['hours'])
    for b_key, block in blocks.items():
        model.Add(sum(x[b_key, ts] for ts in timeslots) == block['hours'])
        
    # 제약 2: 교사는 동시간대에 하나의 수업만 (하드 제약)
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
                
    # 제약 3: 학급은 동시간대에 하나의 수업만 + 고정시간 + 공강 처리
    min_required_hours_base = sum(min(6, periods_config[d]) for d in days)
    fixed_in_1_6 = sum(1 for ts in fixed_timeslots if int(ts.split('_')[1]) <= 6)
    min_required_hours = min_required_hours_base - fixed_in_1_6

    for grade, cls in grades_classes:
        for ts in timeslots:
            d, p_str = ts.split('_')
            p = int(p_str)
            
            class_vars = []
            for i, hc in enumerate(homeroom_classes):
                if hc['grade'] == grade and hc['class_col'] == cls:
                    class_vars.append(x[f"HR_{i}", ts])
            # 이동그룹(base_grp)별로 하나만 class_vars에 추가하기 위한 추적 딕셔너리
            base_group_vars = {}
            for b_key, block in blocks.items():
                if block['grade'] == grade:
                    has_class = False
                    for c_dict in block['classes']:
                        if c_dict['class_col'] == cls:
                            has_class = True
                            break
                    if has_class:
                        # Extract base group (e.g. B from B1)
                        m_base = re.match(r'^([A-Z])', block['group'])
                        base_grp = m_base.group(1) if m_base else block['group']
                        base_key = f"G{grade}_Group_{base_grp}"
                        
                        if base_key not in base_group_vars:
                            base_group_vars[base_key] = []
                        base_group_vars[base_key].append(x[b_key, ts])

            # 각 base_grp에 대해 대표 변수를 생성하여 class_vars에 추가
            for base_key, vars_list in base_group_vars.items():
                if len(vars_list) == 1:
                    class_vars.append(vars_list[0])
                else:
                    # 동일 base_grp(B, B1, B2 등)의 수업들이 겹칠 수 있도록 OR 변수를 생성
                    base_var = model.NewBoolVar(f"base_var_{grade}_{cls}_{base_key}_{ts}")
                    model.AddMaxEquality(base_var, vars_list)
                    class_vars.append(base_var)
            
            is_fixed = ts in fixed_timeslots
            total_h = homeroom_demands.get((grade, cls), 0)
            is_real_class = total_h > 0
            
            # 고정 시간(창체 등)에는 수업 배정 금지
            if is_fixed:
                if class_vars:
                    model.Add(sum(class_vars) == 0)
            elif class_vars:
                # 학급은 한 시간에 최대 1수업
                model.AddAtMostOne(class_vars)
                # 시수가 충분한 반은 1~6교시에 빈칸 없이 배정
                if p <= 6 and is_real_class and total_h >= min_required_hours:
                    model.Add(sum(class_vars) >= 1)

    # 제약 4: 같은 과목 하루 최대 1회 (블록타임 금지)
    # ─────────────────────────────────────────────────────
    # avoid_block_classes = True(기본값) → 하루에 같은 과목 1회만 허용 (하드 제약)
    # avoid_block_classes = False → 블록타임 허용
    avoid_block = advanced_options.get('avoid_block_classes', True)

    import math

    # 과목별 총 시수
    subject_total_hours = {}
    for i, hc in enumerate(homeroom_classes):
        g, c, sub = hc['grade'], hc['class_col'], hc['subject']
        subject_total_hours[(g, c, sub)] = subject_total_hours.get((g, c, sub), 0) + hc['hours']
    for b_key, block in blocks.items():
        g = block['grade']
        for c_dict in block['classes']:
            c = c_dict['class_col']
            sub = c_dict['subject']
            subject_total_hours[(g, c, sub)] = subject_total_hours.get((g, c, sub), 0) + block['hours']

    # (학년, 반, 과목, 요일) → {변수ID: CP변수} 딕셔너리 (중복 제거)
    subject_vars_by_class_day = {}  # key → dict{var_id: cp_var}

    for i, hc in enumerate(homeroom_classes):
        g, c, sub = hc['grade'], hc['class_col'], hc['subject']
        for ts in timeslots:
            day, _ = ts.split('_')
            key = (g, c, sub, day)
            if key not in subject_vars_by_class_day:
                subject_vars_by_class_day[key] = {}
            # 고유 ID로 중복 방지
            subject_vars_by_class_day[key][f"HR_{i}_{ts}"] = x[f"HR_{i}", ts]

    for b_key, block in blocks.items():
        g = block['grade']
        for c_dict in block['classes']:
            c = c_dict['class_col']
            sub = c_dict['subject']
            for ts in timeslots:
                day, _ = ts.split('_')
                key = (g, c, sub, day)
                if key not in subject_vars_by_class_day:
                    subject_vars_by_class_day[key] = {}
                # 같은 (b_key, ts)는 한 번만 추가 (중복 제거)
                subject_vars_by_class_day[key][f"{b_key}_{ts}"] = x[b_key, ts]

    for key, var_dict in subject_vars_by_class_day.items():
        g, c, sub, day = key
        var_list = list(var_dict.values())
        if not var_list:
            continue
        total_h = subject_total_hours.get((g, c, sub), 0)

        if avoid_block:
            hard_limit = 1  # 하루 1회 고정 (블록타임 완전 금지)
        else:
            hard_limit = max(2, math.ceil(total_h / len(days)))

        # 항상 제약 추가 (len > hard_limit 조건 제거 → 변수가 1개여도 올바른 제약)
        model.Add(sum(var_list) <= hard_limit)
            
    # 제약 5: 서브그룹 (B1, B2 등) 동시간대 진행 불가
    subgroup_vars_by_base_day = {}
    for b_key, block in blocks.items():
        grade = block['grade']
        grp = block['group']
        m_sub = re.match(r'^([A-Z])\d+$', grp)
        if m_sub:
            base_grp = m_sub.group(1)
            for ts in timeslots:
                key = (grade, base_grp, ts)
                if key not in subgroup_vars_by_base_day:
                    subgroup_vars_by_base_day[key] = []
                subgroup_vars_by_base_day[key].append(x[b_key, ts])
                
    for key, var_list in subgroup_vars_by_base_day.items():
        if len(var_list) > 1:
            model.AddAtMostOne(var_list)

    # 제약 6: 같은 base 그룹(C1, C2 / B1, B2 등) 이동수업은 가급적 다른 요일에 배치 (소프트 제약)
    # 같은 base 그룹의 서브그룹들이 같은 요일에 배치되면 페널티
    subgroup_day_vars = {}  # (grade, base_grp, day) → [block_vars]
    for b_key, block in blocks.items():
        grade = block['grade']
        grp = block['group']
        m_sub = re.match(r'^([A-Z])\d+$', grp)
        if m_sub:
            base_grp = m_sub.group(1)
            for ts in timeslots:
                day, _ = ts.split('_')
                key = (grade, base_grp, day)
                if key not in subgroup_day_vars:
                    subgroup_day_vars[key] = {}
                if b_key not in subgroup_day_vars[key]:
                    subgroup_day_vars[key][b_key] = []
                subgroup_day_vars[key][b_key].append(x[b_key, ts])


    # ── 고급 옵션 (소프트 제약 및 페널티) ──
    penalties = []
    
    # 교사 요일별 수업 시수 수집
    teacher_day_vars = {t: {d: [] for d in days} for t in teachers}
    for i, hc in enumerate(homeroom_classes):
        t = hc['teacher']
        for ts in timeslots:
            d, _ = ts.split('_')
            teacher_day_vars[t][d].append(x[f"HR_{i}", ts])
            
    for b_key, block in blocks.items():
        for c in block['classes']:
            t = c['teacher']
            for ts in timeslots:
                d, _ = ts.split('_')
                teacher_day_vars[t][d].append(x[b_key, ts])

    distribute_evenly = advanced_options.get('distribute_teachers_evenly', False)
    min_one_hour = advanced_options.get('min_one_hour_per_day', False)
    avoid_3_consec = advanced_options.get('avoid_3_consecutive_classes', False)

    for t in teachers:
        for d in days:
            vars_for_day = teacher_day_vars[t][d]
            if not vars_for_day:
                continue
                
            day_sum = sum(vars_for_day)
            day_count_var = model.NewIntVar(0, 10, f"count_{t}_{d}")
            model.Add(day_sum == day_count_var)
            
            # 고급 옵션 2: 하루 최소 1시간 배정
            if min_one_hour and teacher_demands[t] >= len(days):
                # 0시간인 경우 페널티 부과
                is_zero = model.NewBoolVar(f"is_zero_{t}_{d}")
                model.Add(day_count_var == 0).OnlyEnforceIf(is_zero)
                model.Add(day_count_var > 0).OnlyEnforceIf(is_zero.Not())
                # 하루라도 빈 날이 있으면 페널티
                penalties.append(is_zero * 100)
                
            # 고급 옵션 1: 요일별 편차 최소화 (제곱 최소화 방식 근사)
            if distribute_evenly:
                sq_var = model.NewIntVar(0, 100, f"sq_{t}_{d}")
                model.AddMultiplicationEquality(sq_var, [day_count_var, day_count_var])
                penalties.append(sq_var * 10)
                
            # 고급 옵션 3: 3연속 수업 방지
            if avoid_3_consec:
                for p in range(len(vars_for_day) - 2):
                    # 3연속이면 페널티 부여
                    is_3_consec = model.NewBoolVar(f"3_consec_{t}_{d}_{p}")
                    # vars_for_day[p] + vars_for_day[p+1] + vars_for_day[p+2] == 3 일때 is_3_consec = 1
                    model.Add(vars_for_day[p] + vars_for_day[p+1] + vars_for_day[p+2] == 3).OnlyEnforceIf(is_3_consec)
                    model.Add(vars_for_day[p] + vars_for_day[p+1] + vars_for_day[p+2] < 3).OnlyEnforceIf(is_3_consec.Not())
                    penalties.append(is_3_consec * 50)

    # 소프트 제약: 같은 base 그룹(B1↔B2, C1↔C2 등)은 가급적 다른 요일에 배치
    # subgroup_day_vars: (grade, base_grp, day) → {b_key: [vars]}
    for (grade, base_grp, day), bkey_vars in subgroup_day_vars.items():
        if len(bkey_vars) < 2:
            continue
        # 각 서브그룹이 해당 요일에 배정되는지 나타내는 boolvar
        subgrp_on_day = []
        for b_key, var_list in bkey_vars.items():
            is_on_day = model.NewBoolVar(f"sgrp_day_{grade}_{base_grp}_{day}_{b_key}")
            model.AddMaxEquality(is_on_day, var_list)
            subgrp_on_day.append(is_on_day)
        # 같은 날에 2개 이상의 서브그룹이 배치되면 페널티 (가중치 80 = 준-강제 제약)
        if len(subgrp_on_day) >= 2:
            same_day_count = model.NewIntVar(0, len(subgrp_on_day), f"same_day_{grade}_{base_grp}_{day}")
            model.Add(same_day_count == sum(subgrp_on_day))
            overflow = model.NewIntVar(0, len(subgrp_on_day), f"overflow_{grade}_{base_grp}_{day}")
            model.Add(overflow >= same_day_count - 1)
            model.Add(overflow >= 0)
            penalties.append(overflow * 80)

    if penalties:
        model.Minimize(sum(penalties))


    # ── 풀기 ──
    # 휴리스틱: 이동그룹 먼저 배치
    block_vars = [x[b_key, ts] for b_key in blocks.keys() for ts in timeslots]
    if block_vars:
        model.AddDecisionStrategy(block_vars, cp_model.CHOOSE_FIRST, cp_model.SELECT_MIN_VALUE)
        
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120.0
    solver.parameters.num_search_workers = 8
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
        # 풀 수 없는 경우 → 진단 모드
        return run_diagnostic_solver(homeroom_classes, blocks, teachers, grades_classes, timeslots, days, periods_config, homeroom_demands, fixed_timeslots, advanced_options)


# ──────────────────────────────────────────
# 미리보기 (이동그룹 자동 인식 결과)
# ──────────────────────────────────────────
def preview_data(teacher_file, group_file, grade_classes=None, target_semester=0):
    """파일 업로드 후 파싱 결과를 미리보기로 반환"""
    teacher_records = parse_teacher_workload(teacher_file)
    moving_groups = parse_moving_groups(group_file, target_semester)
    
    # 이동그룹-교사 매칭 결과
    matched = []
    unmatched = []
    
    for mg in moving_groups:
        found = False
        for tr in teacher_records:
            if tr['grade'] == mg['grade'] and str(tr['class_col']) == mg['class_col'] and is_subject_match(mg['subject'], tr['subject']):
                matched.append({
                    'grade': mg['grade'],
                    'group': mg['group'],
                    'subject': mg['subject'],
                    'class_col': mg['class_col'],
                    'teacher': tr['teacher'],
                    'hours': tr['hours'],
                    'matched_subject': tr['subject']
                })
                found = True
                break
        if not found:
            unmatched.append({
                'grade': mg['grade'],
                'group': mg['group'],
                'subject': mg['subject'],
                'class_col': mg['class_col']
            })
    
    # 교사 목록 및 시수 요약
    teacher_summary = {}
    for tr in teacher_records:
        if tr['teacher'] not in teacher_summary:
            teacher_summary[tr['teacher']] = {'total_hours': 0, 'subjects': set()}
        teacher_summary[tr['teacher']]['total_hours'] += tr['hours']
        teacher_summary[tr['teacher']]['subjects'].add(tr['subject'])
    
    teacher_list = []
    for t, info in teacher_summary.items():
        teacher_list.append({
            'teacher': t,
            'total_hours': info['total_hours'],
            'subjects': list(info['subjects'])
        })
    
    # 학년-반 목록
    classes_set = set()
    virtual_classes = set()
    for tr in teacher_records:
        classes_set.add((tr['grade'], str(tr['class_col'])))
        if grade_classes and str(tr['grade']) in grade_classes:
            try:
                # class_col이 숫자인지 확인
                if str(tr['class_col']).isdigit():
                    if int(tr['class_col']) > grade_classes[str(tr['grade'])]:
                        virtual_classes.add((tr['grade'], str(tr['class_col'])))
            except:
                pass
    
    classes_list = [{'grade': g, 'class_col': c, 'is_virtual': (g, c) in virtual_classes} for g, c in sorted(classes_set)]
    
    return {
        'status': 'success',
        'matched_groups': matched,
        'unmatched_groups': unmatched,
        'teachers': teacher_list,
        'classes': classes_list,
        'total_teacher_records': len(teacher_records),
        'total_moving_groups': len(moving_groups)
    }


# ──────────────────────────────────────────
# 메인 엔트리
# ──────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No input JSON provided"}))
        return

    try:
        input_data = json.loads(sys.argv[1])
        mode = input_data.get('mode', 'solve')  # 'solve' 또는 'preview'
        
        teacher_file = input_data.get('teacher_file')
        group_file = input_data.get('group_file')
        target_semester = input_data.get('target_semester', 0)
        
        if mode == 'preview':
            # 미리보기 모드
            grade_classes = input_data.get('grade_classes', {})
            result = preview_data(teacher_file, group_file, grade_classes, target_semester)
            # set을 list로 직렬화
            print(json.dumps(result, ensure_ascii=False))
            return
        
        # solve 모드
        periods = input_data.get('periods', {"월": 7, "화": 7, "수": 6, "목": 7, "금": 6})
        fixed_timeslots = input_data.get('fixed_timeslots', [])
        advanced_options = input_data.get('advanced_options', {})
        
        teacher_records = parse_teacher_workload(teacher_file)
        moving_groups = parse_moving_groups(group_file, target_semester)
        grade_classes = input_data.get('grade_classes', {})
        
        result = run_solver(teacher_records, moving_groups, periods, fixed_timeslots, advanced_options)
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"status": "error", "message": f"시스템 오류: {str(e)}\n{traceback.format_exc()}"}))

if __name__ == "__main__":
    main()
