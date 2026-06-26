import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

export async function POST(req: NextRequest) {
  let tempDir = '';
  try {
    const formData = await req.formData();
    
    // 2개 파일만 받음: 교사 시수표 + 이동그룹
    const teacherFile = formData.get('teacher_file') as File;
    const groupFile = formData.get('group_file') as File;
    const periodsStr = formData.get('periods') as string;
    const fixedSlotsStr = formData.get('fixed_timeslots') as string;
    
    if (!teacherFile || !groupFile) {
      return NextResponse.json({ status: 'error', message: '교사별 시수표와 이동그룹 파일 2개를 모두 업로드해야 합니다.' }, { status: 400 });
    }
    
    const periods = periodsStr ? JSON.parse(periodsStr) : {"월": 7, "화": 7, "수": 6, "목": 7, "금": 6};
    const fixedTimeSlots = fixedSlotsStr ? JSON.parse(fixedSlotsStr) : [];
    
    let gradeClasses = {};
    if (formData.has('grade_classes')) {
      try {
        gradeClasses = JSON.parse(formData.get('grade_classes') as string);
      } catch (e) {}
    }
    
    let targetSemester = 0;
    if (formData.has('target_semester')) {
      targetSemester = parseInt(formData.get('target_semester') as string) || 0;
    }
    
    let advancedOptions = {};
    if (formData.has('advanced_options')) {
      try {
        advancedOptions = JSON.parse(formData.get('advanced_options') as string);
      } catch (e) {
        console.error("고급 옵션 파싱 오류", e);
      }
    }
    
    // 임시 디렉토리 생성
    tempDir = path.join(process.cwd(), '.temp', uuidv4());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 파일 저장 헬퍼
    const saveFile = async (file: File, prefix: string) => {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const filePath = path.join(tempDir, `${prefix}_${file.name}`);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    };
    
    const teacherFilePath = await saveFile(teacherFile, 'teacher');
    const groupFilePath = await saveFile(groupFile, 'group');
    
    // Python 스크립트 실행
    const inputJson = JSON.stringify({
      teacher_file: teacherFilePath,
      group_file: groupFilePath,
      periods: periods,
      fixed_timeslots: fixedTimeSlots,
      grade_classes: gradeClasses,
      target_semester: targetSemester,
      advanced_options: advancedOptions
    });
    
    const pythonScript = path.join(process.cwd(), 'solver.py');
    try {
      const { stdout, stderr } = await execFileAsync('python3', [pythonScript, inputJson], {
        maxBuffer: 1024 * 1024 * 10,
        cwd: process.cwd(),
        env: { ...process.env, PYTHONPATH: process.cwd(), PYTHONIOENCODING: 'utf-8' }
      });
      
      const result = JSON.parse(stdout);
      
      // 임시 파일 정리
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return NextResponse.json(result);
    } catch (e: any) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return NextResponse.json({ 
        status: 'error', 
        message: `알고리즘 실행 오류: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}` 
      }, { status: 500 });
    }

  } catch (error: any) {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return NextResponse.json({ status: 'error', message: `서버 오류: ${error.message}` }, { status: 500 });
  }
}
