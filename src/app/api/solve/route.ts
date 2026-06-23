import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    
    // Get files
    const teacherFile = formData.get('teacher_file') as File;
    const g2File = formData.get('g2_file') as File;
    const g3File = formData.get('g3_file') as File;
    const groupFile = formData.get('group_file') as File;
    const periodsStr = formData.get('periods') as string;
    
    if (!teacherFile || !g2File || !g3File || !groupFile) {
      return NextResponse.json({ status: 'error', message: '모든 파일(4개)을 업로드해야 합니다.' }, { status: 400 });
    }
    
    const periods = periodsStr ? JSON.parse(periodsStr) : {"월": 7, "화": 7, "수": 6, "목": 7, "금": 6};
    
    // Create temp directory
    const tempDir = path.join(process.cwd(), '.temp', uuidv4());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Helper to save file
    const saveFile = async (file: File, prefix: string) => {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const filePath = path.join(tempDir, `${prefix}_${file.name}`);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    };
    
    const teacherFilePath = await saveFile(teacherFile, 'teacher');
    const g2FilePath = await saveFile(g2File, 'g2');
    const g3FilePath = await saveFile(g3File, 'g3');
    const groupFilePath = await saveFile(groupFile, 'group');
    
    // Build python args
    const inputJson = JSON.stringify({
      teacher_file: teacherFilePath,
      g2_file: g2FilePath,
      g3_file: g3FilePath,
      group_file: groupFilePath,
      periods: periods
    });
    
    // Run python script
    const pythonScript = path.join(process.cwd(), 'solver.py');
    try {
      // Use python.exe or python3 depending on env, typically python on windows
      const { stdout, stderr } = await execFileAsync('python', [pythonScript, inputJson]);
      
      // Attempt to parse JSON output from python
      const result = JSON.parse(stdout);
      
      // Cleanup temp files
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return NextResponse.json(result);
    } catch (e: any) {
      // Cleanup temp files
      fs.rmSync(tempDir, { recursive: true, force: true });
      return NextResponse.json({ status: 'error', message: `알고리즘 실행 오류: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}` }, { status: 500 });
    }

  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: `서버 오류: ${error.message}` }, { status: 500 });
  }
}
