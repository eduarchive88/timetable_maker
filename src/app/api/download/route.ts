import { NextRequest, NextResponse } from 'next/server';
import * as xlsx from 'xlsx';

export async function POST(req: NextRequest) {
  try {
    const { schedule, periods } = await req.json();
    if (!schedule || !periods) {
      return NextResponse.json({ message: 'Invalid data' }, { status: 400 });
    }

    // Days and max periods based on config
    const days = ['월', '화', '수', '목', '금'];
    const timeslots: string[] = [];
    
    for (const d of days) {
      if (periods[d]) {
        for (let p = 1; p <= periods[d]; p++) {
          timeslots.push(`${d}_${p}`);
        }
      }
    }

    // Group by teacher
    const teacherSchedules: Record<string, Record<string, string>> = {};
    
    for (const item of schedule) {
      const { teacher, grade, class_col, subject, day, period, type, group } = item;
      if (!teacherSchedules[teacher]) {
        teacherSchedules[teacher] = {};
      }
      const ts = `${day}_${period}`;
      const displayStr = type === 'homeroom' ? `${grade}-${class_col} ${subject}` : `[${group}] ${grade}-${class_col} ${subject}`;
      
      teacherSchedules[teacher][ts] = displayStr;
    }

    // Create rows
    const rows = [];
    
    // Header
    const header = ['교사명', ...timeslots.map(ts => ts.replace('_', ' '))];
    rows.push(header);
    
    for (const teacher of Object.keys(teacherSchedules).sort()) {
      const row = [teacher];
      for (const ts of timeslots) {
        row.push(teacherSchedules[teacher][ts] || '');
      }
      rows.push(row);
    }

    const worksheet = xlsx.utils.aoa_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, '교사별 시간표');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="teacher_timetable.xlsx"'
      }
    });

  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: `엑셀 생성 오류: ${error.message}` }, { status: 500 });
  }
}
