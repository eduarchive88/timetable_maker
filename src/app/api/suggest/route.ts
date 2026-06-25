import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export async function POST(req: NextRequest) {
  let tempDir = '';
  try {
    const formData = await req.formData();
    
    // 2개 파일만 받음
    const teacherFile = formData.get('teacher_file') as File;
    const groupFile = formData.get('group_file') as File;
    const periodsStr = formData.get('periods') as string;
    const periods = JSON.parse(periodsStr || '{}');
    const fixedSlotsStr = formData.get('fixed_timeslots') as string;
    const fixedTimeSlots = fixedSlotsStr ? JSON.parse(fixedSlotsStr) : [];
    const currentScheduleStr = formData.get('current_schedule') as string;
    const currentSchedule = currentScheduleStr ? JSON.parse(currentScheduleStr) : [];
    
    if (!teacherFile) {
      return NextResponse.json({ status: 'error', message: '교사별 시수표 파일이 누락되었습니다.' });
    }

    // 임시 디렉토리 생성
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'timetable-'));
    
    // 파일 저장
    const teacherPath = path.join(tempDir, teacherFile.name);
    await fs.writeFile(teacherPath, Buffer.from(await teacherFile.arrayBuffer()));
    
    let groupPath = "";
    if (groupFile) {
      groupPath = path.join(tempDir, groupFile.name);
      await fs.writeFile(groupPath, Buffer.from(await groupFile.arrayBuffer()));
    }
    
    // Python 실행
    const inputData = {
      teacher_file: teacherPath,
      group_file: groupPath,
      periods: periods,
      fixed_timeslots: fixedTimeSlots,
      current_schedule: currentSchedule
    };
    
    const inputJsonPath = path.join(tempDir, 'input.json');
    await fs.writeFile(inputJsonPath, JSON.stringify(inputData));
    
    const scriptPath = path.join(process.cwd(), 'suggest_swaps.py');
    
    return new Promise<NextResponse>((resolve) => {
      execFile('python', [scriptPath, inputJsonPath], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error && !stdout) {
          console.error("Python Execution Error:", error);
          resolve(NextResponse.json({ status: 'error', message: 'Python 스크립트 실행 실패: ' + (error.message || stderr) }));
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          resolve(NextResponse.json(result));
        } catch (e) {
          console.error("JSON Parse Error:", e);
          resolve(NextResponse.json({ status: 'error', message: '결과 파싱 실패. 출력: ' + stdout.substring(0, 300) }));
        }
      });
    });

  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: '서버 내부 오류: ' + error.message });
  }
}
