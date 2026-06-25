import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export async function POST(req: NextRequest) {
  let tempDir = '';
  try {
    const formData = await req.formData();

    const teacherFile = formData.get('teacher_file') as File;
    const groupFile = formData.get('group_file') as File;
    const periodsStr = formData.get('periods') as string;
    const periods = JSON.parse(periodsStr || '{}');
    const fixedSlotsStr = formData.get('fixed_timeslots') as string;
    const fixedTimeSlots = fixedSlotsStr ? JSON.parse(fixedSlotsStr) : [];
    const currentScheduleStr = formData.get('current_schedule') as string;
    const currentSchedule = currentScheduleStr ? JSON.parse(currentScheduleStr) : [];
    // 시뮬레이션 단계 목록: [{from_teacher, to_teacher, category, label}, ...]
    const stepsStr = formData.get('steps') as string;
    const steps = stepsStr ? JSON.parse(stepsStr) : [];

    if (!teacherFile) {
      return NextResponse.json({ status: 'error', message: '교사별 시수표 파일이 누락되었습니다.' });
    }

    // 임시 디렉토리 생성 및 파일 저장
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simulate-'));

    const teacherPath = path.join(tempDir, teacherFile.name);
    await fs.writeFile(teacherPath, Buffer.from(await teacherFile.arrayBuffer()));

    let groupPath = '';
    if (groupFile) {
      groupPath = path.join(tempDir, groupFile.name);
      await fs.writeFile(groupPath, Buffer.from(await groupFile.arrayBuffer()));
    }

    // 입력 JSON 작성
    const inputData = {
      teacher_file: teacherPath,
      group_file: groupPath,
      periods,
      fixed_timeslots: fixedTimeSlots,
      current_schedule: currentSchedule,
      steps,
      advanced_options: {
        avoid_block_classes: true,
        distribute_teachers_evenly: true,
        min_one_hour_per_day: true
      }
    };

    const inputJsonPath = path.join(tempDir, 'simulate_input.json');
    await fs.writeFile(inputJsonPath, JSON.stringify(inputData));

    const scriptPath = path.join(process.cwd(), 'simulate_swap.py');

    const response = await new Promise<NextResponse>((resolve) => {
      execFile(
        'python',
        [scriptPath, inputJsonPath],
        { maxBuffer: 1024 * 1024 * 20, timeout: 180000 },  // 3분 타임아웃
        (error, stdout, stderr) => {
          if (error && !stdout) {
            console.error('Simulate Error:', error);
            resolve(NextResponse.json({
              status: 'error',
              message: '시뮬레이션 실패: ' + (error.message || stderr)
            }));
            return;
          }

          try {
            const result = JSON.parse(stdout);
            resolve(NextResponse.json(result));
          } catch (e) {
            console.error('JSON Parse Error:', e, 'stdout:', stdout.substring(0, 500));
            resolve(NextResponse.json({
              status: 'error',
              message: '결과 파싱 실패: ' + stdout.substring(0, 300)
            }));
          }
        }
      );
    });
    
    return response;

  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: '서버 내부 오류: ' + error.message });
  } finally {
    if (tempDir) {
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
