import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import util from 'util';

const execFileAsync = util.promisify(execFile);

/** 파일 업로드 후 이동그룹 자동 인식 결과를 미리보기로 반환 */
export async function POST(req: NextRequest) {
  let tempDir = '';
  try {
    const formData = await req.formData();
    
    const teacherFile = formData.get('teacher_file') as File;
    const groupFile = formData.get('group_file') as File;
    
    if (!teacherFile || !groupFile) {
      return NextResponse.json({ 
        status: 'error', 
        message: '교사별 시수표와 이동그룹 파일이 모두 필요합니다.' 
      }, { status: 400 });
    }
    
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
    
    // 임시 디렉토리 생성
    tempDir = path.join(process.cwd(), '.temp', uuidv4());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 파일 저장
    const saveFile = async (file: File, prefix: string) => {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const filePath = path.join(tempDir, `${prefix}_${file.name}`);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    };
    
    const teacherPath = await saveFile(teacherFile, 'teacher');
    const groupPath = await saveFile(groupFile, 'group');
    
    // Python solver.py를 preview 모드로 실행
    const inputJson = JSON.stringify({
      mode: 'preview',
      teacher_file: teacherPath,
      group_file: groupPath,
      grade_classes: gradeClasses,
      target_semester: targetSemester
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
        message: `파일 분석 오류: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}` 
      }, { status: 500 });
    }

  } catch (error: any) {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return NextResponse.json({ status: 'error', message: `서버 오류: ${error.message}` }, { status: 500 });
  }
}
