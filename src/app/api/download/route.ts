import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export async function POST(req: NextRequest) {
  try {
    const { schedule, periods } = await req.json();

    if (!schedule) {
      return NextResponse.json({ status: 'error', message: 'No schedule provided' }, { status: 400 });
    }

    const days = ['월', '화', '수', '목', '금'];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('교사별 시간표');

    const teachers = Array.from(new Set(schedule.map((s: any) => s.teacher))).sort() as string[];

    // Header
    const headerRow = ['교사명', ...days.flatMap(day => Array.from({length: periods[day]}, (_, i) => `${day}${i+1}`))];
    worksheet.addRow(headerRow);
    
    // Header styling
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    for (const teacher of teachers) {
      const teacherSchedule = schedule.filter((s: any) => s.teacher === teacher);
      
      const rowData: any[] = [teacher];
      let colIdx = 2;
      
      const cellStyles: { col: number, isCollision: boolean, text: string }[] = [];

      for (const day of days) {
        for (let p = 1; p <= periods[day]; p++) {
          const classes = teacherSchedule.filter((s: any) => s.day === day && s.period === p);
          let cellText = '';
          let isCollision = false;

          if (classes.length > 0) {
            const lines = classes.map((s: any) => `${s.grade}-${s.class_col} ${s.subject}`).join('\n');
            if (classes.length > 1) {
              cellText = `[충돌]\n${lines}`;
              isCollision = true;
            } else {
              cellText = lines;
            }
          }
          rowData.push(cellText);
          cellStyles.push({ col: colIdx, isCollision, text: cellText });
          colIdx++;
        }
      }
      
      const addedRow = worksheet.addRow(rowData);
      addedRow.height = 30; // make row taller for multi-line
      
      // Apply styles
      cellStyles.forEach(style => {
        const cell = addedRow.getCell(style.col);
        cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
        
        // Borders
        cell.border = {
          top: {style:'thin', color: {argb:'FFDDDDDD'}},
          bottom:{style:'thin', color: {argb:'FFDDDDDD'}},
          left:{style:'thin', color: {argb:'FFDDDDDD'}},
          right:{style:'thin', color: {argb:'FFDDDDDD'}}
        };

        if (style.isCollision) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFC7CE' } // Light red
          };
          cell.font = { color: { argb: 'FF9C0006' }, bold: true }; // Dark red text
        }
      });
    }

    // Set column widths
    worksheet.columns.forEach((column, idx) => {
      column.width = idx === 0 ? 12 : 15;
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="teacher_timetable.xlsx"',
      },
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
