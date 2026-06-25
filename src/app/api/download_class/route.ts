import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export async function POST(req: NextRequest) {
  try {
    const { schedule, periods, classes } = await req.json();

    if (!schedule) {
      return NextResponse.json({ status: 'error', message: 'No schedule provided' }, { status: 400 });
    }

    const days = ['월', '화', '수', '목', '금'];
    const maxPeriod = Math.max(...Object.values(periods as Record<string, number>));

    const workbook = new ExcelJS.Workbook();
    
    // Group classes by grade
    const grades = Array.from(new Set(classes.map((c: any) => c.grade))).sort();

    for (const grade of grades) {
      const gradeClasses = classes.filter((c: any) => c.grade === grade).sort((a: any, b: any) => parseInt(a.class_col) - parseInt(b.class_col));
      if (gradeClasses.length === 0) continue;
      
      const ws = workbook.addWorksheet(`${grade}학년 학급별 시간표`);
      
      // Default col widths
      ws.getColumn(1).width = 8;
      for(let i=2; i<=6; i++) ws.getColumn(i).width = 20;

      let currentRow = 1;

      for (const cls of gradeClasses) {
        // Title
        const titleRow = ws.getRow(currentRow);
        titleRow.getCell(1).value = `${grade}학년 ${cls.class_col}반 시간표`;
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
        const grid: {text: string, isMoving: boolean, group: string}[][] = Array.from({ length: maxPeriod }, () => 
            Array(days.length).fill(null)
        );

        const classSchedule = schedule.filter((s: any) => s.grade === grade && s.class_col === cls.class_col);
        
        for (const s of classSchedule) {
            const dIdx = days.indexOf(s.day);
            const pIdx = s.period - 1;
            if (dIdx >= 0 && pIdx >= 0 && pIdx < maxPeriod) {
                const isMoving = s.type === 'moving_group';
                const newText = isMoving ? `${s.subject}\n(${s.teacher})\n[${s.group}]` : `${s.subject}\n(${s.teacher})`;
                if (!grid[pIdx][dIdx]) {
                    grid[pIdx][dIdx] = { text: newText, isMoving, group: s.group || '' };
                } else {
                    grid[pIdx][dIdx].text += `\n---\n${newText}`;
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
          
          let maxLines = 2; // Default for normal class (subject + teacher)
          for (let d = 0; d < days.length; d++) {
             const cellData = grid[p][d];
             if (cellData && cellData.text) {
                 let physicalLines = 0;
                 const lines = cellData.text.split('\n');
                 for (const line of lines) {
                     // Assume ~8 Korean characters per line for width 20
                     physicalLines += Math.max(1, Math.ceil(line.length / 8));
                 }
                 if (physicalLines > maxLines) maxLines = physicalLines;
             }
          }
          
          // Set generous dynamic height: 26 points per line + 15 points padding
          row.height = Math.max(60, maxLines * 26 + 15);
          
          row.getCell(1).value = `${p + 1}교시`;
          row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(1).border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };

          for (let d = 0; d < days.length; d++) {
             const cell = row.getCell(d + 2);
             const cellData = grid[p][d];
             cell.value = cellData ? cellData.text : '';
             cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
             cell.border = { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
             
             if (cellData && cellData.isMoving) {
                 const color = getGroupColor(cellData.group || '');
                 cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
             }
          }
          currentRow++;
        }
        
        currentRow += 3; // spacing between classes
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="class_timetables.xlsx"',
      },
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
