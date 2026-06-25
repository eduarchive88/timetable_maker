import sys
import json
import copy
import traceback

# solver.py에서 공통 함수 임포트
from solver import parse_teacher_workload, parse_moving_groups, run_solver

# 한글 깨짐 방지
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')


def apply_reassignment(base_records, moving_groups, reassignment):
    """
    base_records와 moving_groups에 교사 교체(재배정)를 적용한 복사본을 반환.
    reassignment: [{'from_teacher': '김서휘', 'to_teacher': '김희정', 'category': '사회', 'target_classes': [...]}, ...]
    """
    from suggest_swaps import categorize_subject

    # base_records 복사
    new_records = copy.deepcopy(base_records)

    # 개별 클래스 단위 교체
    for r in reassignment:
        target_classes = r.get('target_classes', [])
        if target_classes:
            for tc in target_classes:
                for rec in new_records:
                    def _s(val): return str(val) if val is not None else ''
                    if rec['teacher'] == tc.get('from') and \
                       _s(rec.get('grade')) == _s(tc.get('grade')) and \
                       _s(rec.get('class_col')) == _s(tc.get('class_col')) and \
                       _s(rec.get('group')) == _s(tc.get('group')) and \
                       _s(rec.get('subject')) == _s(tc.get('subject')):
                        rec['teacher'] = tc.get('to')
        else:
            # Fallback for old advice format without target_classes
            key = (r['from_teacher'], r.get('category', '*'))
            to_teacher = r['to_teacher']
            for rec in new_records:
                cat = categorize_subject(rec['subject'])
                if rec['teacher'] == r['from_teacher']:
                    if r.get('category', '*') == '*' or cat == r.get('category'):
                        rec['teacher'] = to_teacher

    # moving_groups 복사 (교체할 대상이 없음 - 교사 정보는 base_records에만 존재)
    new_groups = copy.deepcopy(moving_groups)

    return new_records, new_groups


def count_conflicts(schedule, periods):
    """
    배치된 시간표에서 교사/학급 충돌 수를 계산.
    같은 교사가 같은 (day, period)에 2회 이상 → 충돌
    같은 학급이 같은 (day, period)에 2회 이상 → 충돌
    """
    teacher_slots = {}   # teacher → {(day, period)}
    class_slots = {}     # (grade, cls) → {(day, period): count}
    conflict_count = 0

    # 교사 충돌
    teacher_dp = {}
    class_dp = {}
    for item in schedule:
        t = item.get('teacher', '')
        dp = (item.get('day'), item.get('period'))
        g = item.get('grade')
        c = item.get('class_col')

        if t:
            if t not in teacher_dp:
                teacher_dp[t] = {}
            teacher_dp[t][dp] = teacher_dp[t].get(dp, 0) + 1

        if g and c:
            key = (g, c)
            if key not in class_dp:
                class_dp[key] = {}
            class_dp[key][dp] = class_dp[key].get(dp, 0) + 1

    for t, dp_map in teacher_dp.items():
        for dp, cnt in dp_map.items():
            if cnt > 1:
                conflict_count += cnt - 1

    for cls_key, dp_map in class_dp.items():
        for dp, cnt in dp_map.items():
            if cnt > 1:
                conflict_count += cnt - 1

    return conflict_count


def main():
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"status": "error", "message": "입력 파일 경로가 필요합니다."}, ensure_ascii=False))
            return

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
        advanced_options = input_data.get('advanced_options', {
            'avoid_block_classes': True,
            'distribute_teachers_evenly': True,
            'min_one_hour_per_day': True
        })
        # 시뮬레이션 단계 목록: [{'from_teacher': ..., 'to_teacher': ..., 'category': ...}, ...]
        steps = input_data.get('steps', [])

        # 원본 데이터 파싱
        base_records = parse_teacher_workload(teacher_file)
        moving_groups = parse_moving_groups(group_file)

        results = []
        cumulative_reassignment = []

        # 기준선: 현재 충돌 수 (solver 없이 추정 — 현재 스케줄에서 계산)
        current_schedule = input_data.get('current_schedule', [])
        baseline_conflicts = len([s for s in current_schedule if s.get('isConflict')])

        for idx, step in enumerate(steps):
            cumulative_reassignment.append(step)

            # 교사 교체 적용
            new_records, new_groups = apply_reassignment(base_records, moving_groups, cumulative_reassignment)

            # Solver 실행
            try:
                solve_result = run_solver(new_records, new_groups, periods, fixed_timeslots, advanced_options)
                status = solve_result.get('status', 'error')
                schedule = solve_result.get('schedule', [])
                conflicts = count_conflicts(schedule, periods)
                delta = baseline_conflicts - conflicts if idx == 0 else results[-1]['conflict_count'] - conflicts

                results.append({
                    "step": idx + 1,
                    "label": step.get('label', f"Step {idx+1}"),
                    "from_teacher": step.get('from_teacher'),
                    "to_teacher": step.get('to_teacher'),
                    "category": step.get('category'),
                    "status": status,
                    "conflict_count": conflicts,
                    "delta": delta,
                    "message": solve_result.get('message', ''),
                    "schedule": schedule  # UI 반영을 위해 전체 시간표 전달
                })
            except Exception as e:
                results.append({
                    "step": idx + 1,
                    "label": step.get('label', f"Step {idx+1}"),
                    "from_teacher": step.get('from_teacher'),
                    "to_teacher": step.get('to_teacher'),
                    "category": step.get('category'),
                    "status": "error",
                    "conflict_count": -1,
                    "delta": 0,
                    "message": f"시뮬레이션 오류: {str(e)}"
                })

        print(json.dumps({
            "status": "success",
            "baseline_conflicts": baseline_conflicts,
            "results": results
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": f"시뮬레이션 실패: {str(e)}\n{traceback.format_exc()}"
        }, ensure_ascii=False))


if __name__ == '__main__':
    main()
