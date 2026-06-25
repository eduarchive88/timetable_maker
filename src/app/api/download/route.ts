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
      
      const rowData: any[] = [`${teacher}(${teacherSchedule.length})`];
      let colIdx = 2;
      
      const cellStyles: { col: number, isCollision: boolean, text: string, group?: string }[] = [];

      for (const day of days) {
        for (let p = 1; p <= periods[day]; p++) {
          const classes = teacherSchedule.filter((s: any) => s.day === day && s.period === p);
          let cellText = '';
          let isCollision = false;
          let groupStr = '';

          if (classes.length > 0) {
            const lines = classes.map((s: any) => {
              if (s.type === 'moving_group') {
                return `${s.grade}-${s.class_col} ${s.subject} [${s.group}]`;
              }
              return `${s.grade}-${s.class_col} ${s.subject}`;
            }).join('\n');
            
            if (classes.length > 1) {
              cellText = `[충돌]\n${lines}`;
              isCollision = true;
            } else {
              cellText = lines;
              if (classes[0].type === 'moving_group') {
                 groupStr = classes[0].group ? classes[0].group[0] : 'A';
              }
            }
          }
          rowData.push(cellText);
          cellStyles.push({ col: colIdx, isCollision, text: cellText, group: groupStr });
          colIdx++;
        }
      }
      
      const addedRow = worksheet.addRow(rowData);
      
      let maxLines = 1;
      for (const style of cellStyles) {
         if (style.text) {
             let physicalLines = 0;
             const lines = style.text.split('\n');
             for (const line of lines) {
                 physicalLines += Math.max(1, Math.ceil(line.length / 8));
             }
             if (physicalLines > maxLines) maxLines = physicalLines;
         }
      }
      addedRow.height = Math.max(45, maxLines * 26 + 15);
      
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

        const getGroupColor = (groupName: string) => {
            if (!groupName) return 'FFFFF5EE';
            const baseGroupName = groupName.replace(/[0-9\s_]+$/, '');
            const pastelColors = [
                'FFFFE4E1', 'FFE6E6FA', 'FFF0FFF0', 'FFFFFACD',
                'FFF0F8FF', 'FFFFF0F5', 'FFE0FFFF', 'FFF5DEB3',
                'FFD3FFCE', 'FFFFDAB9', 'FFE0B0FF', 'FFF5FFFA'
            ];
            let hash = 0;
            for (let i = 0; i < baseGroupName.length; i++) {
                hash = baseGroupName.charCodeAt(i) + ((hash << 5) - hash);
            }
            return pastelColors[Math.abs(hash) % pastelColors.length];
        };

        if (style.isCollision) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFCCCC' } // Light red background
          };
          cell.font = { color: { argb: 'FFFF0000' }, bold: true }; // Red text
        } else if (style.group) {
          const color = getGroupColor(style.group);
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: color }
          };
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
