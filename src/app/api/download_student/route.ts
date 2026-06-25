import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export async function POST(req: NextRequest) {
  try {
    const { schedule, students, periods } = await req.json();

    if (!schedule || !students) {
      return NextResponse.json({ status: 'error', message: 'No schedule or student data provided' }, { status: 400 });
    }

    const days = ['월', '화', '수', '목', '금'];
    const maxPeriod = Math.max(...Object.values(periods as Record<string, number>));

    const workbook = new ExcelJS.Workbook();

    const classGroups: Record<string, any[]> = {};
    for (const st of students) {
      const key = `${st.grade}학년 ${st.class_col}반`;
      if (!classGroups[key]) classGroups[key] = [];
      classGroups[key].push(st);
    }

    for (const [className, classStudents] of Object.entries(classGroups)) {
      classStudents.sort((a, b) => a.student_id.localeCompare(b.student_id));
      
      const ws = workbook.addWorksheet(className.replace(/ /g, '_'));
      
      // Default col widths
      ws.getColumn(1).width = 8;
      for(let i=2; i<=6; i++) ws.getColumn(i).width = 20;

      let currentRow = 1;

      for (const st of classStudents) {
        // Title
        const titleRow = ws.getRow(currentRow);
        titleRow.getCell(1).value = `[${st.student_id}] ${st.name} 개인 시간표`;
        titleRow.font = { bold: true, size: 12 };
        ws.mergeCells(currentRow, 1, currentRow, 6);
        currentRow++;
        
        // Header
        const headerRow = ws.getRow(currentRow);
        headerRow.values = ['교시', ...days];
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };
        // set borders
        for(let i=1; i<=6; i++) {
            headerRow.getCell(i).border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        }
        currentRow++;

        // Grid
        const grid: {text: string, isCollision: boolean}[][] = Array.from({ length: maxPeriod }, () => 
            Array(days.length).fill({text:'', isCollision: false})
        );

        const fillGrid = (s: any) => {
            const dIdx = days.indexOf(s.day);
            const pIdx = s.period - 1;
            if (dIdx >= 0 && pIdx >= 0 && pIdx < maxPeriod) {
                const current = grid[pIdx][dIdx];
                const newText = `${s.subject}\n(${s.teacher})`;
                if (current && current.text) {
                    grid[pIdx][dIdx] = {
                        text: `[충돌]\n${current.text}\n---\n${newText}`,
                        isCollision: true
                    };
                } else {
                    grid[pIdx][dIdx] = {
                        text: newText,
                        isCollision: false
                    };
                }
            }
        };

        const hrClasses = schedule.filter((s: any) => s.type === 'homeroom' && s.grade == st.grade && String(s.class_col) == String(st.class_col));
        for (const s of hrClasses) fillGrid(s);

        for (const sel of st.selections) {
          const match = sel.match(/^([A-Z][0-9]?)_(.+)_([0-9]+)반$/);
          if (match) {
            const grp = match[1];
            const sub = match[2].trim();
            const cls = match[3].trim();
            
            const mgClasses = schedule.filter((s: any) => 
              s.type === 'moving_group' && s.grade == st.grade &&
              s.group === grp && s.subject === sub && String(s.class_col) === cls
            );
            
            for (const s of mgClasses) fillGrid(s);
          }
        }

        // Write grid to worksheet
        for (let p = 0; p < maxPeriod; p++) {
          const row = ws.getRow(currentRow);
          row.height = 45; // taller rows
          row.getCell(1).value = `${p + 1}교시`;
          row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(1).border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };

          for (let d = 0; d < days.length; d++) {
             const cell = row.getCell(d + 2);
             cell.value = grid[p][d] ? grid[p][d].text : '';
             cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
             cell.border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
             
             if (grid[p][d] && grid[p][d].isCollision) {
                 cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
                 cell.font = { color: { argb: 'FFFF0000' }, bold: true };
             }
          }
          currentRow++;
        }
        
        currentRow += 2; // spacing between students
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
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
