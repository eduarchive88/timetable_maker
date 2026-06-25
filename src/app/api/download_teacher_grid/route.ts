import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export async function POST(req: NextRequest) {
  try {
    const { schedule, periods } = await req.json();

    if (!schedule) {
      return NextResponse.json({ status: 'error', message: 'No schedule provided' }, { status: 400 });
    }

    const days = ['월', '화', '수', '목', '금'];
    const maxPeriod = Math.max(...Object.values(periods as Record<string, number>));

    const workbook = new ExcelJS.Workbook();
    
    // Get unique teachers
    const teachers = Array.from(new Set(schedule.map((s: any) => s.teacher))).sort() as string[];

    for (const teacher of teachers) {
      const ws = workbook.addWorksheet(teacher);
      
      // Default col widths
      ws.getColumn(1).width = 8;
      for(let i=2; i<=6; i++) ws.getColumn(i).width = 20;

      let currentRow = 1;

      // Title
      const titleRow = ws.getRow(currentRow);
      const teacherSchedule = schedule.filter((s: any) => s.teacher === teacher);
      titleRow.getCell(1).value = `[${teacher}] 개인 시간표 (총 ${teacherSchedule.length}시간)`;
      titleRow.font = { bold: true, size: 14 };
      ws.mergeCells(currentRow, 1, currentRow, 6);
      currentRow++;
      
      // Header
      const headerRow = ws.getRow(currentRow);
      headerRow.values = ['교시', ...days];
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      for(let i=1; i<=6; i++) {
          headerRow.getCell(i).border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
          headerRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      }
      currentRow++;

      // Grid
      const grid: {text: string, isMoving: boolean, group: string, isCollision: boolean}[][] = Array.from({ length: maxPeriod }, () => 
          Array(days.length).fill(null)
      );
      
      for (const s of teacherSchedule) {
          const dIdx = days.indexOf(s.day);
          const pIdx = s.period - 1;
          if (dIdx >= 0 && pIdx >= 0 && pIdx < maxPeriod) {
              const isMoving = s.type === 'moving_group';
              const newText = isMoving ? `${s.grade}-${s.class_col} ${s.subject}\n[${s.group}]` : `${s.grade}-${s.class_col} ${s.subject}`;
              if (!grid[pIdx][dIdx]) {
                  grid[pIdx][dIdx] = { text: newText, isMoving, group: s.group || '', isCollision: false };
              } else {
                  grid[pIdx][dIdx].text = `[충돌]\n${grid[pIdx][dIdx].text}\n---\n${newText}`;
                  grid[pIdx][dIdx].isCollision = true;
              }
          }
      }

      // Write grid to worksheet
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

      for (let p = 0; p < maxPeriod; p++) {
        const row = ws.getRow(currentRow);
        
        let maxLines = 1;
        for (let d = 0; d < days.length; d++) {
            const cellData = grid[p][d];
            if (cellData && cellData.text) {
                let physicalLines = 0;
                const lines = cellData.text.split('\n');
                for (const line of lines) {
                    physicalLines += Math.max(1, Math.ceil(line.length / 8));
                }
                if (physicalLines > maxLines) maxLines = physicalLines;
            }
        }
        
        row.height = Math.max(60, maxLines * 26 + 15); // 높이를 넉넉하게 키워 글자가 짤리지 않게 함
        
        row.getCell(1).value = `${p + 1}교시`;
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(1).border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };

        for (let d = 0; d < days.length; d++) {
           const cell = row.getCell(d + 2);
           const cellData = grid[p][d];
           cell.value = cellData ? cellData.text : '';
           cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
           cell.border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
           
           if (cellData) {
               if (cellData.isCollision) {
                   cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
                   cell.font = { color: { argb: 'FFFF0000' }, bold: true };
               } else if (cellData.isMoving) {
                   const color = getGroupColor(cellData.group || '');
                   cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
               }
           }
        }
        currentRow++;
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="teacher_personal_timetables.xlsx"',
      },
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
