import { NextRequest, NextResponse } from 'next/server';
import * as xlsx from 'xlsx';

export async function POST(req: NextRequest) {
  try {
    const { schedule, students, periods } = await req.json();

    if (!schedule || !students) {
      return NextResponse.json({ status: 'error', message: 'No schedule or student data provided' }, { status: 400 });
    }

    const days = ['월', '화', '수', '목', '금'];
    const maxPeriod = Math.max(...Object.values(periods as Record<string, number>));

    const wb = xlsx.utils.book_new();

    // Group students by grade and class
    const classGroups: Record<string, any[]> = {};
    for (const st of students) {
      const key = `${st.grade}학년 ${st.class_col}반`;
      if (!classGroups[key]) classGroups[key] = [];
      classGroups[key].push(st);
    }

    for (const [className, classStudents] of Object.entries(classGroups)) {
      // Sort students by ID
      classStudents.sort((a, b) => a.student_id.localeCompare(b.student_id));

      const sheetData: any[][] = [];

      for (const st of classStudents) {
        // Title for the student
        sheetData.push([`[${st.student_id}] ${st.name} 개인 시간표`]);
        
        // Header
        const header = ['교시', ...days];
        sheetData.push(header);

        // Build the grid
        const grid: string[][] = Array.from({ length: maxPeriod }, () => Array(days.length).fill(''));

        // Fill homeroom classes
        const hrClasses = schedule.filter((s: any) => 
          s.type === 'homeroom' && s.grade == st.grade && String(s.class_col) == String(st.class_col)
        );
        for (const s of hrClasses) {
          const dIdx = days.indexOf(s.day);
          const pIdx = s.period - 1;
          if (dIdx >= 0 && pIdx >= 0 && pIdx < maxPeriod) {
            grid[pIdx][dIdx] = `${s.subject}\n(${s.teacher})`;
          }
        }

        // Fill moving group classes
        for (const sel of st.selections) {
          // sel looks like "A_사회와 문화_1반"
          // We parse it back
          const match = sel.match(/^([A-Z][0-9]?)_(.+)_([0-9]+)반$/);
          if (match) {
            const grp = match[1];
            const sub = match[2].trim();
            const cls = match[3].trim();
            
            const mgClasses = schedule.filter((s: any) => 
              s.type === 'moving_group' && s.grade == st.grade &&
              s.group === grp && s.subject === sub && String(s.class_col) === cls
            );
            
            for (const s of mgClasses) {
              const dIdx = days.indexOf(s.day);
              const pIdx = s.period - 1;
              if (dIdx >= 0 && pIdx >= 0 && pIdx < maxPeriod) {
                grid[pIdx][dIdx] = `${s.subject}\n(${s.teacher})`;
              }
            }
          }
        }

        // Add grid to sheet data
        for (let p = 0; p < maxPeriod; p++) {
          sheetData.push([`${p + 1}교시`, ...grid[p]]);
        }
        
        // Empty row separator
        sheetData.push([]);
        sheetData.push([]);
      }

      const ws = xlsx.utils.aoa_to_sheet(sheetData);
      
      // Auto size columns roughly
      const wscols = [{ wch: 6 }]; // 교시
      for (let i = 0; i < days.length; i++) wscols.push({ wch: 18 });
      ws['!cols'] = wscols;

      xlsx.utils.book_append_sheet(wb, ws, className.replace(/ /g, '_'));
    }

    const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="student_timetables.xlsx"',
      },
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
