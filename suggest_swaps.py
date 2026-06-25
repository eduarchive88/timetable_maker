import sys
import json
import traceback
import copy
from ortools.sat.python import cp_model

# solver.py에서 공통 함수 임포트
from solver import parse_teacher_workload, parse_moving_groups, is_subject_match, prepare_solver_data

def categorize_subject(subject_name):
    """과목을 교과 영역으로 분류"""
    s = subject_name.replace(" ", "")
    if any(k in s for k in ['국어', '언어', '매체', '화법', '작문', '문학', '고전', '독서']): return '국어'
    if any(k in s for k in ['수학', '미적', '기하', '확률', '통계', '수1', '수2']): return '수학'
    if any(k in s for k in ['영어', '영미', '영독', '영작']): return '영어'
    if any(k in s for k in ['사회', '지리', '윤리', '역사', '한국사', '정치', '경제', '법', '사문', '생윤', '윤생', '세계사', '동아시아']): return '사회'
    if any(k in s for k in ['과학', '물리', '화학', '생명', '지구', '생과', '융합과학']): return '과학'
    if any(k in s for k in ['체육', '스포츠', '운동', '보건']): return '체육'
    if any(k in s for k in ['음악', '미술', '연극', '영화', '예술']): return '예술'
    if any(k in s for k in ['기술', '가정', '정보', '공학', '농업', '상업', '해양']): return '기술가정'
    if any(k in s for k in ['한문', '철학', '논리', '심리', '교육', '진로', '창의']): return '교양'
    if any(k in s for k in ['창체', '창의적체험', '자율', '동아리', '봉사', '진로활동']): return '창체'
    return '기타'

def is_swap_valid(base_records, moving_groups, target_classes):
    import copy
    
    cand_records = copy.deepcopy(base_records)
    for tc in target_classes:
        for rec in cand_records:
            def _s(val): return str(val) if val is not None else ''
            if rec['teacher'] == tc.get('from') and \
               _s(rec.get('grade')) == _s(tc.get('grade')) and \
               _s(rec.get('class_col')) == _s(tc.get('class_col')) and \
               _s(rec.get('group')) == _s(tc.get('group')) and \
               _s(rec.get('subject')) == _s(tc.get('subject')):
                rec['teacher'] = tc.get('to')
                
    try:
        homeroom_classes, blocks, teachers, grades_classes, homeroom_demands = prepare_solver_data(cand_records, moving_groups)
        
        # 교사 총 시수 검증 (40시간 상한선)
        teacher_demands = {t: 0 for t in teachers}
        for hc in homeroom_classes:
            teacher_demands[hc['teacher']] += hc['hours']
        for b_key, block in blocks.items():
            for c in block['classes']:
                teacher_demands[c['teacher']] += block['hours']
                
        for t, hours in teacher_demands.items():
            if hours > 40:
                return False
                
        # 이동그룹 내 동일 교사 중복 배정 검증
        for b_key, block in blocks.items():
            t_counts = {}
            for c in block['classes']:
                t = c['teacher']
                t_counts[t] = t_counts.get(t, 0) + 1
                if t_counts[t] > 1:
                    return False
        return True
    except Exception:
        return False

def _generate_subject_group_advice(base_records, conflicts, moving_groups):
    """충돌 교사를 교과군별로 분류하여 시수 조정 조언(개별 수업 이관/교환) 생성"""
    if not conflicts:
        return "", []
    
    group_map = {}  # {교과군: {교사: [tr, tr, ...]}}
    teacher_total_hours = {} # {교사: 총시수(창체제외)}
    for tr in base_records:
        cat = categorize_subject(tr['subject'])
        t = tr['teacher']
        if cat not in ('창체', '기타'):
            teacher_total_hours[t] = teacher_total_hours.get(t, 0) + tr['hours']
        if cat not in group_map:
            group_map[cat] = {}
        if t not in group_map[cat]:
            group_map[cat][t] = []
        group_map[cat][t].append(tr)
    
    conflict_teachers = set()
    for s in conflicts:
        t = s.get('teacher')
        if t:
            conflict_teachers.add(t)
    
    same_cat_advice = []
    structured_advice = []
    
    for teacher in sorted(conflict_teachers):
        for tr in base_records:
            if tr['teacher'] != teacher:
                continue
            cat = categorize_subject(tr['subject'])
            if cat in ('창체', '기타'):
                continue
                
            hours = tr['hours']
            subject_desc = f"'{tr['subject']}'({tr['grade']}학년"
            if tr.get('class_col'): subject_desc += f" {tr['class_col']}반)"
            elif tr.get('group'): subject_desc += f" {tr['group']}그룹)"
            else: subject_desc += ")"
            
            # 같은 교과군 내 다른 교사
            other_teachers = [t for t in group_map.get(cat, {}).keys() if t != teacher]
            other_teachers.sort(key=lambda x: teacher_total_hours.get(x, 0)) # 시수 적은 순
            
            from_before = teacher_total_hours.get(teacher, 0)
            swapped = False
            
            # 1. 교과군 내 해결방안 탐색
            for recv_teacher in other_teachers:
                t_before = teacher_total_hours.get(recv_teacher, 0)
                
                # 상호 교환 제안 (우선순위)
                for recv_tr in group_map[cat][recv_teacher]:
                    if abs(recv_tr['hours'] - hours) <= 2:
                        recv_subject_desc = f"'{recv_tr['subject']}'({recv_tr['grade']}학년"
                        if recv_tr.get('class_col'): recv_subject_desc += f" {recv_tr['class_col']}반)"
                        elif recv_tr.get('group'): recv_subject_desc += f" {recv_tr['group']}그룹)"
                        else: recv_subject_desc += ")"
                        
                        from_after_swap = from_before - hours + recv_tr['hours']
                        t_after_swap = t_before - recv_tr['hours'] + hours
                        
                        target_classes = [
                            { "from": teacher, "to": recv_teacher, "grade": tr.get('grade'), "class_col": tr.get('class_col'), "group": tr.get('group'), "subject": tr['subject'] },
                            { "from": recv_teacher, "to": teacher, "grade": recv_tr.get('grade'), "class_col": recv_tr.get('class_col'), "group": recv_tr.get('group'), "subject": recv_tr['subject'] }
                        ]
                        
                        if not is_swap_valid(base_records, moving_groups, target_classes):
                            continue
                            
                        label = f"🔄 [교환] [{cat}군] {teacher}의 {subject_desc}({hours}h) ↔ {recv_teacher}의 {recv_subject_desc}({recv_tr['hours']}h) 교환"
                        
                        if not any(a.get('label') == label for a in structured_advice):
                            structured_advice.append({
                                "category": cat,
                                "from_teacher": teacher,
                                "from_hours": hours,
                                "to_teacher": recv_teacher,
                                "to_hours": recv_tr['hours'],
                                "subjects": [tr['subject']],
                                "is_swap": True,
                                "target_subject": recv_tr['subject'],
                                "label": label,
                                "target_classes": target_classes
                            })
                            same_cat_advice.append(f"   ▶ {label} (본인: {from_before}→{from_after_swap}h / 교환자: {t_before}→{t_after_swap}h)")
                            swapped = True
                            break
                            
                # 단순 이관 제안 (2시간 이하)
                if hours <= 2:
                    from_after = from_before - hours
                    t_after = t_before + hours
                    
                    target_classes = [
                        { "from": teacher, "to": recv_teacher, "grade": tr.get('grade'), "class_col": tr.get('class_col'), "group": tr.get('group'), "subject": tr['subject'] }
                    ]
                    
                    if not is_swap_valid(base_records, moving_groups, target_classes):
                        continue
                        
                    label = f"➡️ [이관] [{cat}군] {teacher}의 {subject_desc}({hours}h)을 {recv_teacher}에게 양도"
                    
                    if not any(a.get('label') == label for a in structured_advice):
                        structured_advice.append({
                            "category": cat,
                            "from_teacher": teacher,
                            "from_hours": hours,
                            "to_teacher": recv_teacher,
                            "to_hours": 0,
                            "subjects": [tr['subject']],
                            "is_swap": False,
                            "label": label,
                            "target_classes": target_classes
                        })
                        same_cat_advice.append(f"   ▶ {label} (본인: {from_before}→{from_after}h / 양수자: {t_before}→{t_after}h)")
                        swapped = True
            


    advice_lines = []
    if same_cat_advice:
        advice_lines.append("[1순위] 교과군 내 해결방안:")
        advice_lines.extend(same_cat_advice)

    if advice_lines:
        msg = "💡 추천 시수 조정(교환/이관) 방안:\n\n" + "\n".join(advice_lines)
    else:
        msg = "💡 현재 3시간 이하의 이관이나 적절한 상호 교환 후보를 찾지 못했습니다. 수업 구성을 확인해주세요."
        
    return msg, structured_advice


def _analyze_conflict_pairs_and_suggest(current_schedule, base_records, fixed_timeslots, periods):
    """
    충돌 쌍을 분석하고, 교과군 내 교사 교체로 해결 가능한 방안을 시뮬레이션하여 제안.
    '시간이 꽉 찬 학급'에 남은 충돌이 있을 때 사용.
    """
    # 고정 시간대 튜플 변환
    fixed_set = set()
    for ft in fixed_timeslots:
        parts = ft.split('_')
        if len(parts) == 2:
            fixed_set.add((parts[0], int(parts[1])))

    # (day, period, grade, class_col) → 수업 목록 그룹핑
    slot_map = {}
    for s in current_schedule:
        key = (s.get('day'), s.get('period'), s.get('grade'), s.get('class_col'))
        if key not in slot_map:
            slot_map[key] = []
        slot_map[key].append(s)

    # 충돌 쌍 추출 (같은 슬롯에 2개 이상 배정된 경우)
    conflict_pairs = []
    for key, items in slot_map.items():
        if len(items) >= 2:
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    conflict_pairs.append((key, items[i], items[j]))

    if not conflict_pairs:
        return []

    # 교과군별 교사 → 시수 매핑
    group_map = {}   # {교과군: {교사: 총시수}}
    teacher_subjects = {}  # {교사: [과목 목록]}
    for tr in base_records:
        cat = categorize_subject(tr['subject'])
        t = tr['teacher']
        group_map.setdefault(cat, {})[t] = group_map.get(cat, {}).get(t, 0) + tr['hours']
        teacher_subjects.setdefault(t, []).append(tr['subject'])

    # 교사별 담당 시간대 인덱스 구성 (현재 배정 기준)
    teacher_slot_map = {}  # {교사: set((day,period,grade,class_col))}
    for s in current_schedule:
        t = s.get('teacher')
        key = (s.get('day'), s.get('period'), s.get('grade'), s.get('class_col'))
        teacher_slot_map.setdefault(t, set()).add(key)

    suggestions = []
    seen = set()

    for (day, period, grade, cls), s1, s2 in conflict_pairs:
        slot_label = f"{day} {period}교시 {grade}학년 {cls}반"

        for conflict_item, other_item in [(s1, s2), (s2, s1)]:
            t_orig = conflict_item.get('teacher')
            subj = conflict_item.get('subject')
            cat = categorize_subject(subj)
            if cat in ('창체', '기타'):
                continue

            # 같은 교과군 내 교체 가능한 교사 탐색
            candidate_teachers = []
            for t_alt, t_hrs in sorted(group_map.get(cat, {}).items(), key=lambda x: x[1]):
                if t_alt == t_orig:
                    continue
                # 이 슬롯에 이미 다른 수업이 있으면 불가
                alt_slots = teacher_slot_map.get(t_alt, set())
                conflict_slot = (day, period, grade, cls)
                if conflict_slot in alt_slots:
                    continue
                # 같은 교과 or 연관 과목을 가르치는지 확인
                alt_subjects = set(teacher_subjects.get(t_alt, []))
                same_group = any(categorize_subject(s) == cat for s in alt_subjects)
                candidate_teachers.append((t_alt, t_hrs, same_group))

            if not candidate_teachers:
                key_s = f"NO_{t_orig}_{subj}_{slot_label}"
                if key_s not in seen:
                    seen.add(key_s)
                    suggestions.append(
                        f"⚠️ [{slot_label}] [{subj}({t_orig})] — {cat}군 내 교체 가능한 교사가 없습니다.\n"
                        f"   → 교과 담당 교사를 추가 배치하거나, 이 반의 {cat} 수업 시수를 줄이는 방안을 검토하세요."
                    )
                continue

            # 최대 2명까지 제안
            for t_alt, t_hrs, same_group in candidate_teachers[:2]:
                key_s = f"{t_orig}→{t_alt}_{subj}_{slot_label}"
                if key_s in seen:
                    continue
                seen.add(key_s)
                compat = "✅ 같은 교과군 담당" if same_group else "⚡ 교과군 동일 (과목 다름)"
                suggestions.append(
                    f"✨ [{slot_label}] 충돌 해결 방안\n"
                    f"   [{subj}] 담당을 [{t_orig}] → [{t_alt}]({t_hrs}시간)으로 교체\n"
                    f"   {compat} | {t_alt} 선생님 담당 과목: {', '.join(set(teacher_subjects.get(t_alt, [])))[:60]}"
                )

    return suggestions



def evaluate_records(teacher_records, moving_groups, periods_config, max_time=5.0, fixed_timeslots=[]):
    """시수 배정의 충돌 수를 평가하는 함수"""
    model = cp_model.CpModel()
    
    days = list(periods_config.keys())
    timeslots = []
    for d in days:
        for p in range(1, periods_config[d] + 1):
            timeslots.append(f"{d}_{p}")
            
    # 데이터 준비
    homeroom_classes, blocks, teachers, grades_classes, homeroom_demands = prepare_solver_data(teacher_records, moving_groups)

    # 변수 생성
    x = {}
    for i, hc in enumerate(homeroom_classes):
        for ts in timeslots:
            x[f"HR_{i}", ts] = model.NewBoolVar(f"HR_{i}_{ts}")
    for b_key, block in blocks.items():
        for ts in timeslots:
            x[b_key, ts] = model.NewBoolVar(f"{b_key}_{ts}")
            
    # 시수 제약
    for i, hc in enumerate(homeroom_classes):
        model.Add(sum(x[f"HR_{i}", ts] for ts in timeslots) == hc['hours'])
    for b_key, block in blocks.items():
        model.Add(sum(x[b_key, ts] for ts in timeslots) == block['hours'])
        
    # 교사 겹침 패널티
    penalties = []
    teacher_penalty_vars = {t: [] for t in teachers}
    
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
                penalties.append(ov)
                teacher_penalty_vars[teacher].append(ov)

    # 학급 겹침 패널티
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
            
            if len(class_vars) > 1:
                ov = model.NewIntVar(0, 10, f"ov_c_{grade}_{cls}_{ts}")
                model.Add(sum(class_vars) - 1 <= ov)
                penalties.append(ov)
                
    model.Minimize(sum(penalties))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time
    status = solver.Solve(model)
    
    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        total_overlap = int(solver.ObjectiveValue())
        bottlenecks = []
        for t in teachers:
            t_ov = sum(int(solver.Value(v)) for v in teacher_penalty_vars[t])
            if t_ov > 0:
                bottlenecks.append((t, t_ov))
        bottlenecks.sort(key=lambda x: x[1], reverse=True)
        return total_overlap, bottlenecks
    return 9999, []

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No input JSON provided"}))
        return

    try:
        arg = sys.argv[1]
        if arg.startswith('{'):
            input_data = json.loads(arg)
        else:
            with open(arg, 'r', encoding='utf-8') as f:
                input_data = json.load(f)
                
        teacher_file = input_data.get('teacher_file')
        group_file = input_data.get('group_file')
        periods = input_data.get('periods', {"월": 7, "화": 7, "수": 6, "목": 7, "금": 6})
        fixed_timeslots = input_data.get('fixed_timeslots', [])
        
        base_records = parse_teacher_workload(teacher_file)
        moving_groups = parse_moving_groups(group_file)
        
        # 1. 기본 평가
        base_penalty, bottlenecks = evaluate_records(base_records, moving_groups, periods, max_time=5.0, fixed_timeslots=fixed_timeslots)
        
        current_schedule = input_data.get('current_schedule', [])
        
        if base_penalty == 0:
            conflicts = [s for s in current_schedule if s.get('isConflict')]
            if not conflicts:
                print(json.dumps({
                    "status": "success",
                    "message": "현재 시간표에 충돌이 없습니다. 시수 교환이 필요하지 않습니다.",
                    "suggestions": []
                }, ensure_ascii=False))
                return
            else:
                formatted_suggestions = []
                teacher_schedule = {}   # 교사 → 담당 (day, period) 집합
                class_schedule = {}     # "학년-반" → (day, period) → 수업 정보
                
                # 고정 시간대를 (day, period) 튜플 집합으로 변환
                fixed_set = set()
                for ft in fixed_timeslots:
                    parts = ft.split('_')
                    if len(parts) == 2:
                        fixed_set.add((parts[0], int(parts[1])))
                
                for s in current_schedule:
                    t = s.get('teacher')
                    c = f"{s.get('grade')}-{s.get('class_col')}"
                    d_p = (s.get('day'), s.get('period'))
                    
                    if t not in teacher_schedule: teacher_schedule[t] = set()
                    teacher_schedule[t].add(d_p)
                    
                    if c not in class_schedule: class_schedule[c] = {}
                    class_schedule[c][d_p] = s
                
                days = list(periods.keys())
                
                # 충돌 건별 분석
                seen_suggestions = set()
                for s in conflicts:
                    t1 = s.get('teacher')
                    c1 = f"{s.get('grade')}-{s.get('class_col')}"
                    dp1 = (s.get('day'), s.get('period'))
                    subj1 = s.get('subject')
                    
                    # 1순위: 고정 시간대 제외한 빈 시간으로 이동 가능한 슬롯 탐색
                    found_empty = False
                    for d in days:
                        for p in range(1, periods[d] + 1):
                            dp2 = (d, p)
                            if dp1 == dp2: continue
                            if dp2 in fixed_set: continue           # ← 고정 시간대 제외
                            if dp2 in teacher_schedule.get(t1, set()): continue
                            if dp2 in class_schedule.get(c1, {}): continue
                            
                            sug = f"💡 [빈 시간 이동] {dp1[0]} {dp1[1]}교시의 [{c1}반 {subj1}({t1})] 수업을 빈 시간인 {dp2[0]} {dp2[1]}교시로 이동해보세요."
                            if sug not in seen_suggestions:
                                formatted_suggestions.append(sug)
                                seen_suggestions.add(sug)
                            found_empty = True
                            break
                        if found_empty: break
                    
                    # 2순위: 고정 시간대 제외한 같은 반 내 맞교환 탐색
                    if not found_empty:
                        for dp2, s2 in class_schedule.get(c1, {}).items():
                            if dp1 == dp2: continue
                            if dp2 in fixed_set: continue           # ← 고정 시간대 제외
                            if dp1 in fixed_set: continue
                            t2 = s2.get('teacher')
                            subj2 = s2.get('subject')
                            
                            if t1 == t2: continue
                            if dp2 in teacher_schedule.get(t1, set()): continue
                            if dp1 in teacher_schedule.get(t2, set()): continue
                            
                            sug = f"💡 [맞교환] {dp1[0]} {dp1[1]}교시 [{subj1}({t1})] 수업과 {dp2[0]} {dp2[1]}교시 [{subj2}({t2})] 수업을 서로 교환해보세요."
                            if sug not in seen_suggestions:
                                formatted_suggestions.append(sug)
                                seen_suggestions.add(sug)
                            break
                
                # 3순위: 학급이 꽉 차서 이동/교환이 불가한 경우 → 교사 교체 시뮬레이션
                pair_suggestions = []
                if not formatted_suggestions:
                    pair_suggestions = _analyze_conflict_pairs_and_suggest(
                        current_schedule, base_records, fixed_timeslots, periods
                    )
                
                # 교과군별 시수 조정 조언 생성
                subject_group_advice, structured_advice_data = _generate_subject_group_advice(base_records, conflicts, moving_groups)
                
                # 메시지 구성
                msg = f"📊 현재 충돌: {len(conflicts)}건 — 기본 시수 배분에는 문제가 없으나 배정 규칙 충돌입니다.\n\n"
                
                if formatted_suggestions:
                    msg += "── 수동 이동/교환 제안 ──\n"
                elif pair_suggestions:
                    msg += "⚠️ 이 학급의 시간표가 꽉 차있어 단순 이동/교환으로는 해결이 어렵습니다.\n"
                    msg += "아래와 같이 교과군 내 담당 교사를 변경하면 충돌을 해소할 수 있습니다.\n\n"
                    msg += "── 교사 교체 제안 ──\n"
                else:
                    msg += "이동 가능한 빈 시간도 없고 교과군 내 여유 교사도 없습니다.\n"
                    msg += "시수표 자체를 검토하거나 기간제 교사 배치를 고려하세요.\n"
                
                if subject_group_advice:
                    msg += "\n── 교과군 시수 조정 조언 ──\n" + subject_group_advice
                
                all_suggestions = list(seen_suggestions)[:3] + pair_suggestions[:5]
                
                print(json.dumps({
                    "status": "success",
                    "message": msg,
                    "suggestions": all_suggestions,
                    "structured_advice": structured_advice_data
                }, ensure_ascii=False))
                return
            
        if not bottlenecks:
            print(json.dumps({
                "status": "success",
                "message": "구체적인 병목 교사를 찾을 수 없습니다.",
                "suggestions": []
            }))
            return

        structured_advice_data = []
        
        # 교사별 교과 분류 및 총 시수
        teacher_categories = {}
        teacher_total_hours = {}
        for tr in base_records:
            cat = categorize_subject(tr['subject'])
            t = tr['teacher']
            if t not in teacher_categories:
                teacher_categories[t] = set()
            teacher_categories[t].add(cat)
            teacher_total_hours[t] = teacher_total_hours.get(t, 0) + tr['hours']

        # 2. 충돌 원인 상세 분석
        conflict_analysis = []
        for teacher, overlap_count in bottlenecks[:3]:
            # 이 교사가 담당하는 수업 목록
            teacher_classes = [tr for tr in base_records if tr['teacher'] == teacher]
            # 이 교사의 이동그룹 수업
            teacher_moving = [mg for mg in moving_groups 
                            for tr in teacher_classes 
                            if tr['grade'] == mg['grade'] and str(tr['class_col']) == mg['class_col'] 
                            and is_subject_match(mg['subject'], tr['subject'])]
            
            analysis = f"⚠️ [{teacher}] 선생님 (총 {teacher_total_hours.get(teacher, 0)}시간, 충돌 {overlap_count}건)\n"
            analysis += f"   담당 과목: {', '.join(set(tr['subject'] for tr in teacher_classes))}\n"
            if teacher_moving:
                groups = set(mg['group'] for mg in teacher_moving)
                analysis += f"   참여 이동그룹: {', '.join(groups)}\n"
                analysis += f"   → 이동그룹 수업이 동시간대에 겹쳐 충돌 발생"
            else:
                analysis += f"   → 공통수업과 다른 수업이 겹쳐 충돌 발생"
            conflict_analysis.append(analysis)

        # 3. 후보 생성 및 평가
        target_teachers = [t[0] for t in bottlenecks[:3]]
        candidates = []
        
        for tr_idx, tr in enumerate(base_records):
            if tr['teacher'] in target_teachers:
                cat = categorize_subject(tr['subject'])
                alt_teachers = [t for t, cats in teacher_categories.items() if cat in cats and t != tr['teacher']]
                
                for alt_t in alt_teachers:
                    cand_records = copy.deepcopy(base_records)
                    cand_records[tr_idx]['teacher'] = alt_t
                    
                    try:
                        _, blocks, _, _, _ = prepare_solver_data(cand_records, moving_groups)
                        valid = True
                        for b_key, block in blocks.items():
                            t_counts = {}
                            for c in block['classes']:
                                t = c['teacher']
                                t_counts[t] = t_counts.get(t, 0) + 1
                                if t_counts[t] > 1:
                                    valid = False
                                    break
                            if not valid: break
                        if not valid: continue
                    except Exception:
                        continue
                        
                    candidates.append({
                        'orig_teacher': tr['teacher'],
                        'alt_teacher': alt_t,
                        'subject': tr['subject'],
                        'grade': tr['grade'],
                        'class_col': tr['class_col'],
                        'hours': tr['hours'],
                        'records': cand_records
                    })
                    
        # 최대 30개 후보만 평가
        candidates = candidates[:30]
        results = []
        
        for c in candidates:
            new_penalty, _ = evaluate_records(c['records'], moving_groups, periods, max_time=2.0, fixed_timeslots=fixed_timeslots)
            reduction = base_penalty - new_penalty
            if reduction > 0:
                orig_t = c['orig_teacher']
                alt_t = c['alt_teacher']
                h = c['hours']
                
                gap_pre = abs(teacher_total_hours.get(orig_t, 0) - teacher_total_hours.get(alt_t, 0))
                gap_post = abs((teacher_total_hours.get(orig_t, 0) - h) - (teacher_total_hours.get(alt_t, 0) + h))
                gap_improvement = gap_pre - gap_post
                
                results.append({
                    'orig_teacher': orig_t,
                    'alt_teacher': alt_t,
                    'subject': c['subject'],
                    'grade': c['grade'],
                    'class_col': c['class_col'],
                    'hours': h,
                    'new_penalty': new_penalty,
                    'reduction': reduction,
                    'gap_improvement': gap_improvement,
                    'orig_post_hours': teacher_total_hours.get(orig_t, 0) - h,
                    'alt_post_hours': teacher_total_hours.get(alt_t, 0) + h
                })
                
        results.sort(key=lambda x: (x['reduction'], x['gap_improvement']), reverse=True)
        top_results = results[:3]
        
        # 4. 결과 포맷팅
        formatted_suggestions = []
        for r in top_results:
            cat = categorize_subject(r['subject'])
            subject_desc = f"'{r['subject']}'({r['grade']}학년"
            if r.get('class_col'): subject_desc += f" {r['class_col']}반)"
            elif r.get('group'): subject_desc += f" {r['group']}그룹)"
            else: subject_desc += ")"

            label = f"➡️ [연쇄이동] [{cat}군] {r['orig_teacher']}의 {subject_desc}({r['hours']}h)을 {r['alt_teacher']}에게 양도"
            
            # structured_advice_data에 추가
            if not any(a.get('label') == label for a in structured_advice_data):
                structured_advice_data.append({
                    "category": cat,
                    "from_teacher": r['orig_teacher'],
                    "from_hours": r['hours'],
                    "to_teacher": r['alt_teacher'],
                    "to_hours": 0,
                    "subjects": [r['subject']],
                    "is_swap": False,
                    "label": label,
                    "is_chain": True,
                    "target_classes": [
                        { "from": r['orig_teacher'], "to": r['alt_teacher'], "grade": r['grade'], "class_col": r['class_col'], "group": r.get('group'), "subject": r['subject'] }
                    ]
                })

            if r['new_penalty'] == 0:
                msg = (f"✨ 완벽 해결: [{r['orig_teacher']}] → [{r['alt_teacher']}]\n"
                       f"   {r['grade']}학년 {r['class_col']}반 '{r['subject']}' ({r['hours']}시간)을 넘기면 "
                       f"모든 충돌이 해소됩니다.")
            else:
                msg = (f"📉 충돌 감소: [{r['orig_teacher']}] → [{r['alt_teacher']}]\n"
                       f"   {r['grade']}학년 {r['class_col']}반 '{r['subject']}' ({r['hours']}시간)을 넘기면 "
                       f"충돌이 {r['reduction']}건 줄어듭니다.")
                
            msg += f"\n   (교환 후 시수: {r['orig_teacher']} {r['orig_post_hours']}시간, {r['alt_teacher']} {r['alt_post_hours']}시간)"
            formatted_suggestions.append(msg)
            
        # structured_advice_data 정렬 (우선순위: 교환 > 같은교과군 이관 > 타교과/연쇄 이관)
        def sort_key(adv):
            if adv.get("is_swap"): return 0
            if adv.get("is_chain"): return 2
            if "타교과" in adv.get("label", ""): return 2
            return 1
            
        structured_advice_data.sort(key=sort_key)
            
        # 최종 메시지 구성
        full_message = f"📊 현재 충돌 수: {base_penalty}건\n\n"
        full_message += "── 충돌 원인 분석 ──\n\n" + "\n\n".join(conflict_analysis)
        
        if formatted_suggestions:
            full_message += "\n\n── 시수 교환 자동 제안 ──\n"
        else:
            full_message += "\n\n── 시수 조정 조언 ──\n"
            full_message += "💡 시스템이 자동으로 찾은 교환 제안은 없지만, 다음을 시도해보세요:\n"
            for b in bottlenecks[:2]:
                full_message += f" - [{b[0]}] 교사의 시수를 다른 교사에게 분배하여 짐을 덜어주세요.\n"
            full_message += " - 여러 교사가 얽힌 이동그룹 수업의 시간표가 고정되어 충돌을 일으킬 수 있습니다. 그룹 내 과목 구성을 변경해보세요."
        
        print(json.dumps({
            "status": "success",
            "message": full_message,
            "suggestions": formatted_suggestions,
            "structured_advice": structured_advice_data
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"status": "error", "message": f"시스템 오류: {str(e)}\n{traceback.format_exc()}"}))

if __name__ == "__main__":
    main()
