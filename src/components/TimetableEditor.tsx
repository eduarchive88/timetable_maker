'use client';

import React, { useState, useMemo, useEffect } from 'react';

export interface ScheduleItem {
  id?: string;
  blockId?: string;
  type: 'homeroom' | 'moving_group' | 'fixed';
  grade: number;
  class_col: string;
  teacher: string;
  subject: string;
  day: string;
  period: number;
  group?: string;
  isConflict?: boolean;
  conflictReasons?: string[];
}

interface TimetableEditorProps {
  initialSchedule: ScheduleItem[];
  periods: Record<string, number>;
  onDownloadTeacher: (schedule: ScheduleItem[]) => void;
  onDownloadClass: () => void;
  onDownloadTeacherGrid: () => void;
  onSuggestSwaps?: (schedule: ScheduleItem[]) => void;
  isSuggesting?: boolean;
  hasPreviousSuggestions?: boolean;
  onViewPreviousSuggestions?: () => void;
  onRegenerate?: (options: { distribute_teachers_evenly: boolean, min_one_hour_per_day: boolean, avoid_3_consecutive_classes: boolean, avoid_block_classes: boolean }) => void;
  isRegenerating?: boolean;
}

const DAYS = ['월', '화', '수', '목', '금'];

export default function TimetableEditor({ 
  initialSchedule, 
  periods, 
  onDownloadTeacher,
  onDownloadClass,
  onDownloadTeacherGrid,
  onSuggestSwaps,
  isSuggesting = false,
  hasPreviousSuggestions = false,
  onViewPreviousSuggestions,
  onRegenerate,
  isRegenerating = false
}: TimetableEditorProps) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [history, setHistory] = useState<ScheduleItem[][]>([]);
  const [viewMode, setViewMode] = useState<'teacher' | 'class' | 'all_teachers' | 'moving_groups'>('teacher');
  const [selectedTeacher, setSelectedTeacher] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedGrade, setSelectedGrade] = useState<string>('3');

  const [advDistribute, setAdvDistribute] = useState(true);
  const [advMinOneHour, setAdvMinOneHour] = useState(true);
  const [advAvoid3Consec, setAdvAvoid3Consec] = useState(true);
  const [advAvoidBlockClasses, setAdvAvoidBlockClasses] = useState(true);
  const [fitToScreen, setFitToScreen] = useState(false);

  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{day: string, period: number, teacher?: string} | null>(null);

  // Scenario Management
  const [scenarioName, setScenarioName] = useState<string>('초안_1');
  const [savedScenarios, setSavedScenarios] = useState<string[]>([]);

  useEffect(() => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('scenario_'));
      setSavedScenarios(keys.map(k => k.replace('scenario_', '')));
    } catch (e) {
      // Ignore
    }
  }, []);

  const saveScenario = () => {
    if (!scenarioName.trim()) {
      alert('시나리오 이름을 입력하세요.');
      return;
    }
    const data = { schedule };
    try {
      localStorage.setItem(`scenario_${scenarioName}`, JSON.stringify(data));
      if (!savedScenarios.includes(scenarioName)) {
        setSavedScenarios([...savedScenarios, scenarioName]);
      }
      alert(`'${scenarioName}' 시나리오가 저장되었습니다.`);
    } catch (e) {
      alert('저장 용량 초과 또는 브라우저 보안 설정으로 저장할 수 없습니다.');
    }
  };

  const loadScenario = (name: string) => {
    try {
      const dataStr = localStorage.getItem(`scenario_${name}`);
      if (dataStr) {
        const data = JSON.parse(dataStr);
        if (data.schedule) {
          setSchedule(data.schedule);
          setScenarioName(name);
          alert(`'${name}' 시나리오를 성공적으로 불러왔습니다.`);
        }
      }
    } catch (e) {
      alert('시나리오 데이터를 읽는 중 오류가 발생했습니다.');
    }
  };

  // Initialize schedule with unique block IDs
  useEffect(() => {
    let blockCounter = 0;
    // Map existing groups to block IDs
    const movingGroupBlocks: Record<string, string> = {};

    const enriched = initialSchedule.map((s, i) => {
      let bId = '';
      if (s.type === 'moving_group') {
        const key = `${s.grade}_${s.group}`;
        if (!movingGroupBlocks[key]) {
          movingGroupBlocks[key] = `B_${blockCounter++}`;
        }
        bId = movingGroupBlocks[key];
      } else {
        bId = `B_${blockCounter++}`;
      }
      return { ...s, id: `I_${i}`, blockId: bId };
    });
    setSchedule(enriched);
  }, [initialSchedule]);

  // Compute conflicts
  const scheduleWithConflicts = useMemo(() => {
    const computed = [...schedule].map(s => ({ ...s, isConflict: false }));
    
    // Check teacher conflicts
    const teacherMap: Record<string, ScheduleItem[]> = {}; 
    const classMap: Record<string, ScheduleItem[]> = {};

    computed.forEach(s => {
      const tKey = `${s.teacher}_${s.day}_${s.period}`;
      const cKey = `${s.grade}_${s.class_col}_${s.day}_${s.period}`;
      
      if (!teacherMap[tKey]) teacherMap[tKey] = [];
      teacherMap[tKey].push(s);

      if (!classMap[cKey]) classMap[cKey] = [];
      classMap[cKey].push(s);
    });

    computed.forEach(s => {
      const tKey = `${s.teacher}_${s.day}_${s.period}`;
      const cKey = `${s.grade}_${s.class_col}_${s.day}_${s.period}`;
      
      const reasons: string[] = [];
      const tConflicts = teacherMap[tKey].filter(x => x.blockId !== s.blockId);
      if (tConflicts.length > 0) {
        reasons.push(`👨‍🏫 [${s.teacher} 교사] 중복: ${tConflicts.map(x => x.type === 'moving_group' ? `이동(${x.group})` : x.subject).join(', ')}`);
      }
      
      const cConflicts = classMap[cKey].filter(x => x.blockId !== s.blockId);
      if (cConflicts.length > 0) {
        reasons.push(`🏫 [${s.grade}학년 ${s.class_col}반] 중복: ${cConflicts.map(x => x.type === 'moving_group' ? `이동(${x.group})` : x.subject).join(', ')}`);
      }

      s.conflictReasons = Array.from(new Set(reasons));
      s.isConflict = s.conflictReasons.length > 0;
    });

    return computed;
  }, [schedule]);

  // Extract unique teachers and classes
  const teachers = useMemo(() => Array.from(new Set(scheduleWithConflicts.map(s => s.teacher))).sort(), [scheduleWithConflicts]);
  const classes = useMemo(() => Array.from(new Set(scheduleWithConflicts.map(s => `${s.grade}-${s.class_col}`))).sort(), [scheduleWithConflicts]);

  const teacherHours = useMemo(() => {
    const hours: Record<string, number> = {};
    const seen = new Set<string>();
    scheduleWithConflicts.forEach(s => {
      const key = `${s.teacher}_${s.day}_${s.period}`;
      if (!seen.has(key)) {
        seen.add(key);
        hours[s.teacher] = (hours[s.teacher] || 0) + 1;
      }
    });
    return hours;
  }, [scheduleWithConflicts]);

  useEffect(() => {
    if (teachers.length > 0 && !selectedTeacher) setSelectedTeacher(teachers[0]);
    if (classes.length > 0 && !selectedClass) setSelectedClass(classes[0]);
  }, [teachers, classes]);

  const maxPeriods = Math.max(...Object.values(periods));

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, blockId: string, sourceDay: string, sourcePeriod: number, type?: string) => {
    if (type === 'fixed') {
      e.preventDefault();
      return;
    }
    setDraggedBlockId(blockId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${blockId}|${sourceDay}|${sourcePeriod}`);
    // Subtle opacity to the dragging element
    setTimeout(() => {
      if (e.target instanceof HTMLElement) {
        e.target.style.opacity = '0.5';
      }
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = '1';
    }
    setDraggedBlockId(null);
    setDragOverCell(null);
  };

  const handleDragOver = (e: React.DragEvent, day: string, period: number, teacher?: string) => {
    e.preventDefault();
    if (dragOverCell?.day !== day || dragOverCell?.period !== period || dragOverCell?.teacher !== teacher) {
      setDragOverCell({ day, period, teacher });
    }
  };

  const handleDrop = (e: React.DragEvent, targetDay: string, targetPeriod: number, targetTeacher?: string) => {
    e.preventDefault();
    const dragData = e.dataTransfer.getData('text/plain');
    if (!dragData) return;
    
    const parts = dragData.split('|');
    const sourceBlockId = parts[0];
    const draggedSourceDay = parts[1];
    const draggedSourcePeriod = parts.length > 2 ? parseInt(parts[2]) : null;

    // Find the original day/period of the dragged block
    const sourceItems = scheduleWithConflicts.filter(s => 
      s.blockId === sourceBlockId && 
      (draggedSourceDay ? s.day === draggedSourceDay && s.period === draggedSourcePeriod : true)
    );
    if (sourceItems.length === 0) return;
    
    const sourceDay = sourceItems[0].day;
    const sourcePeriod = sourceItems[0].period;

    if (sourceDay === targetDay && sourcePeriod === targetPeriod) {
      setDragOverCell(null);
      return; // No change
    }

    const isTargetFixed = scheduleWithConflicts.some(s => s.day === targetDay && s.period === targetPeriod && s.type === 'fixed');
    const isSourceFixed = scheduleWithConflicts.some(s => s.day === sourceDay && s.period === sourcePeriod && s.type === 'fixed');
    if (isTargetFixed || isSourceFixed) {
      alert("고정된 시간(창체 등)에는 다른 과목을 배치할 수 없습니다.");
      setDragOverCell(null);
      return;
    }

    // 이동수업 전용 뷰: 두 시간대의 모든 수업을 통째로 교환 (전 학년 전체 과목)
    if (viewMode === 'moving_groups') {
      // Save current state to history before changing
      setHistory(prev => [...prev, schedule]);
      
      setSchedule(prev => prev.map(s => {
        if (s.type === 'fixed') return s; // 고정 시간은 건드리지 않음
        
        // 이동수업 뷰에서 드래그 앤 드롭 시, 해당 시간대의 1,2,3학년 모든 교사의 '모든 수업'을 통째로 맞교환
        if (s.day === sourceDay && s.period === sourcePeriod) {
          return { ...s, day: targetDay, period: targetPeriod };
        }
        if (s.day === targetDay && s.period === targetPeriod) {
          return { ...s, day: sourceDay, period: sourcePeriod };
        }
        
        return s;
      }));
      
      setDragOverCell(null);
      return;
    }

    const sourceTeachers = Array.from(new Set(sourceItems.map(s => s.teacher)));
    const sourceClasses = Array.from(new Set(sourceItems.map(s => `${s.grade}_${s.class_col}`)));

    // 이동하는 블록(sourceItems)이 목표 지점(targetDay, targetPeriod)에 도착했을 때
    // 목표 지점에서 이들과 '교사' 또는 '학급'이 겹치는 기존 블록들을 모두 찾아냅니다.
    const targetItems = scheduleWithConflicts.filter(s => 
      s.day === targetDay && s.period === targetPeriod && 
      (sourceTeachers.includes(s.teacher) || sourceClasses.includes(`${s.grade}_${s.class_col}`))
    );

    const targetBlocksToSwap = Array.from(new Set(targetItems.map(s => s.blockId!)));

    // Save current state to history before changing
    setHistory(prev => [...prev, schedule]);

    // Update schedule
    setSchedule(prev => prev.map(s => {
      // 정확히 드래그한 그 시간의 블록만 이동
      if (s.blockId === sourceBlockId && s.day === sourceDay && s.period === sourcePeriod) {
        return { ...s, day: targetDay, period: targetPeriod };
      }
      // 교체되는 대상 블록들도 해당 시간의 블록만 이동
      if (targetBlocksToSwap.includes(s.blockId!) && s.day === targetDay && s.period === targetPeriod) {
        return { ...s, day: sourceDay, period: sourcePeriod };
      }
      return s;
    }));

    setDragOverCell(null);
  };

  const handleUndo = () => {
    if (history.length > 0) {
      const prevSchedule = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setSchedule(prevSchedule);
    }
  };

  const renderCellContent = (day: string, period: number, gridTeacher?: string, gridGrade?: string) => {
    let cellItems: ScheduleItem[] = [];
    if (viewMode === 'teacher') {
      cellItems = scheduleWithConflicts.filter(s => s.teacher === selectedTeacher && s.day === day && s.period === period);
    } else if (viewMode === 'class') {
      const [g, c] = selectedClass.split('-');
      cellItems = scheduleWithConflicts.filter(s => String(s.grade) === g && String(s.class_col) === c && s.day === day && s.period === period);
    } else if (viewMode === 'all_teachers' && gridTeacher) {
      cellItems = scheduleWithConflicts.filter(s => s.teacher === gridTeacher && s.day === day && s.period === period);
    } else if (viewMode === 'moving_groups') {
      const targetG = gridGrade || selectedGrade;
      if (targetG === 'all') {
        cellItems = scheduleWithConflicts.filter(s => s.type === 'moving_group' && s.day === day && s.period === period);
      } else {
        cellItems = scheduleWithConflicts.filter(s => s.type === 'moving_group' && String(s.grade) === targetG && s.day === day && s.period === period);
      }
    }

    if (cellItems.length === 0) return <div className="empty-cell"></div>;

    // Group items by blockId to render draggable blocks
    const blocksMap: Record<string, ScheduleItem[]> = {};
    cellItems.forEach(item => {
      if (!blocksMap[item.blockId!]) blocksMap[item.blockId!] = [];
      blocksMap[item.blockId!].push(item);
    });

    return (
      <div className="cell-blocks">
        {Object.values(blocksMap).map(items => {
          const first = items[0];
          const isConflict = items.some(i => i.isConflict);
          const isFixed = first.type === 'fixed';
          
          let title = '';
          if (isFixed) {
            title = '🔒 창체/고정';
          } else if (viewMode === 'teacher') {
            title = first.type === 'moving_group' 
              ? `[이동${first.group || ''}] ${first.grade}학년 ${first.subject}` 
              : `${first.grade}-${first.class_col} ${first.subject}`;
          } else if (viewMode === 'class') {
            title = first.type === 'moving_group'
              ? `[이동${first.group || ''}] ${first.subject} (${first.teacher})`
              : `${first.subject} (${first.teacher})`;
          } else if (viewMode === 'moving_groups') {
            const subjects = Array.from(new Set(items.map(i => i.subject))).join(', ');
            title = `[이동${first.group || ''}] ${first.grade}학년\n(${subjects})`;
          } else {
            // all_teachers
            title = first.type === 'moving_group'
              ? `[이동${first.group || ''}] ${first.grade}학년 ${first.subject}`
              : `${first.grade}-${first.class_col} ${first.subject}`;
          }

          // moving_groups 모드: 과목 수에 따라 폰트 크기 축소
          const movingFontSize = viewMode === 'moving_groups'
            ? title.length > 80 ? '0.6rem'
            : title.length > 50 ? '0.68rem'
            : title.length > 30 ? '0.75rem'
            : '0.82rem'
            : undefined;

          return (
            <div
              key={first.blockId}
              draggable={!isFixed}
              onDragStart={(e) => handleDragStart(e, first.blockId!, day, period, first.type)}
              onDragEnd={handleDragEnd}
              className={`schedule-block ${isConflict ? 'conflict' : ''} ${first.type === 'moving_group' ? 'moving' : ''}`}
              style={{
                background: isFixed ? '#475569' : (isConflict ? '#ef4444' : (first.type === 'moving_group' ? '#8b5cf6' : '#3b82f6')),
                color: isFixed ? '#cbd5e1' : 'white',
                border: isFixed ? '1px solid #64748b' : 'none',
                cursor: isFixed ? 'not-allowed' : 'grab'
              }}
            >
              <div className="block-title" style={movingFontSize ? { fontSize: movingFontSize, lineHeight: '1.3' } : undefined}>{title}</div>
              {isConflict && (
                <div 
                  className="conflict-badge" 
                  title="클릭하여 충돌 원인 보기"
                  onClick={(e) => {
                    e.stopPropagation();
                    alert(`🚨 [충돌 원인 분석]\n\n${first.conflictReasons?.join('\n\n')}`);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  충돌
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const totalConflicts = scheduleWithConflicts.filter(s => s.isConflict).length;

  return (
    <div className={`timetable-editor ${viewMode === 'all_teachers' ? 'all-teachers-mode' : ''}`}>
      <div className="editor-header">
        <div className="scenario-controls" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', background: 'var(--surface)', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 'bold' }}>💾 시나리오:</span>
          <input 
            type="text" 
            value={scenarioName} 
            onChange={(e) => setScenarioName(e.target.value)} 
            placeholder="시나리오 이름" 
            style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
          />
          <button onClick={saveScenario} style={{ padding: '0.25rem 0.75rem', borderRadius: '0.25rem', background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>저장</button>
          
          <span style={{ marginLeft: '1rem', fontWeight: 'bold' }}>📂 불러오기:</span>
          <select 
            onChange={(e) => {
              if (e.target.value) {
                if (confirm(`'${e.target.value}' 시나리오를 불러오시겠습니까? 현재 저장하지 않은 변경사항은 유실됩니다.`)) {
                  loadScenario(e.target.value);
                }
                e.target.value = ''; // Reset
              }
            }}
            style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
          >
            <option value="">-- 버전 선택 --</option>
            {savedScenarios.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="controls-row">
          <div className="view-toggles">
            <button 
              className={`toggle-btn ${viewMode === 'all_teachers' ? 'active' : ''}`}
              onClick={() => setViewMode('all_teachers')}
            >
              🌐 전체 교사 뷰
            </button>
            <button 
              className={`toggle-btn ${viewMode === 'teacher' ? 'active' : ''}`}
              onClick={() => setViewMode('teacher')}
            >
              👨‍🏫 교사별 뷰
            </button>
            <button 
              className={`toggle-btn ${viewMode === 'class' ? 'active' : ''}`}
              onClick={() => setViewMode('class')}
            >
              🏫 학급별 뷰
            </button>
            <button 
              className={`toggle-btn ${viewMode === 'moving_groups' ? 'active' : ''}`}
              onClick={() => setViewMode('moving_groups')}
            >
              🔄 이동수업 전용 뷰
            </button>
            {viewMode === 'all_teachers' && (
              <button 
                className={`toggle-btn ${fitToScreen ? 'active' : ''}`}
                onClick={() => setFitToScreen(!fitToScreen)}
                style={{ background: fitToScreen ? '#10b981' : '#475569', marginLeft: 'auto' }}
              >
                {fitToScreen ? '🔍 원래 크기로' : '🔍 화면에 맞추기'}
              </button>
            )}
          </div>
          
          {viewMode !== 'all_teachers' && (
            <div className="selector">
              {viewMode === 'teacher' ? (
                <select value={selectedTeacher} onChange={e => setSelectedTeacher(e.target.value)}>
                  {teachers.map(t => <option key={t} value={t}>{t} 선생님 ({teacherHours[t] || 0}시간)</option>)}
                </select>
              ) : viewMode === 'class' ? (
                <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
                  {classes.map(c => <option key={c} value={c}>{c}반</option>)}
                </select>
              ) : (
                <select value={selectedGrade} onChange={e => setSelectedGrade(e.target.value)}>
                  <option value="all">2, 3학년 모두보기</option>
                  <option value="2">2학년</option>
                  <option value="3">3학년</option>
                </select>
              )}
            </div>
          )}
        </div>
        
        {/* Advanced Regenerate Options */}
        {onRegenerate && (
          <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', color: '#475569' }}>⚙️ 교사 배정 최적화 옵션</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#334155' }}>
              <input type="checkbox" checked={advDistribute} onChange={e => setAdvDistribute(e.target.checked)} />
              모든 교사 요일별 고른 분배
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#334155' }}>
              <input type="checkbox" checked={advMinOneHour} onChange={e => setAdvMinOneHour(e.target.checked)} />
              하루 최소 1시간 이상 배정
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#334155' }}>
              <input type="checkbox" checked={advAvoid3Consec} onChange={e => setAdvAvoid3Consec(e.target.checked)} />
              3연속 수업 최소화
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: advAvoidBlockClasses ? '#dc2626' : '#334155', fontWeight: advAvoidBlockClasses ? 'bold' : 'normal' }}>
              <input type="checkbox" checked={advAvoidBlockClasses} onChange={e => setAdvAvoidBlockClasses(e.target.checked)} />
              {advAvoidBlockClasses ? '🚫 블록타임 금지 (같은날 동일과목 1회)' : '✅ 블록타임 허용 (같은날 동일과목 중복 허용)'}
            </label>
            <button 
              className="btn-primary"
              style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', marginLeft: 'auto', background: '#3b82f6' }}
              onClick={() => onRegenerate({ distribute_teachers_evenly: advDistribute, min_one_hour_per_day: advMinOneHour, avoid_3_consecutive_classes: advAvoid3Consec, avoid_block_classes: advAvoidBlockClasses })}
              disabled={isRegenerating}
            >
              {isRegenerating ? '⏳ 재생성 중...' : '조건 적용하여 재생성'}
            </button>
          </div>
        )}

        <div className="actions-row">
          <div className="status-indicator">
            {totalConflicts > 0 ? (
              <span className="text-danger">⚠️ 현재 겹치는 수업: {totalConflicts}개</span>
            ) : (
              <span className="text-success">✅ 모든 수업 정상 배치됨</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {onSuggestSwaps && (
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button className="btn" onClick={() => onSuggestSwaps(scheduleWithConflicts)} disabled={isSuggesting} style={{ background: '#6366f1', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                  {isSuggesting ? '분석 중...' : '💡 시수 조정 제안 받기'}
                </button>
                {hasPreviousSuggestions && onViewPreviousSuggestions && (
                  <button className="btn" onClick={onViewPreviousSuggestions} style={{ background: '#8b5cf6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                    👁️ 이전 제안 다시보기
                  </button>
                )}
              </div>
            )}
            <button 
              className="btn" 
              onClick={handleUndo} 
              disabled={history.length === 0} 
              style={{ 
                background: history.length === 0 ? '#475569' : '#f59e0b', 
                color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.25rem', 
                cursor: history.length === 0 ? 'not-allowed' : 'pointer' 
              }}>
              ↩️ 되돌리기
            </button>
            <button className="btn-download" onClick={() => onDownloadTeacher(scheduleWithConflicts)}>
              👨‍🏫 전체 교사 시간표
            </button>
            <button className="btn-download" onClick={onDownloadClass} style={{ background: '#10b981' }}>
              🏫 각 학급별 시간표
            </button>
            <button className="btn-download" onClick={onDownloadTeacherGrid} style={{ background: '#8b5cf6' }}>
              📝 교사 개인 시간표
            </button>
          </div>
        </div>
      </div>

      <div className={`timetable-grid-container ${fitToScreen && viewMode === 'all_teachers' ? 'fit-to-screen' : ''}`}>
        {viewMode === 'all_teachers' ? (
          <div className={`timetable-grid all-teachers-grid ${fitToScreen ? 'fit-to-screen' : ''}`}>
            <div className="grid-header-row">
              <div className="grid-corner">교사명</div>
              {DAYS.map(day => (
                <div key={day} className="grid-header-cell-group" style={{ flex: periods[day] }}>
                  <div className="day-label">{day}</div>
                  <div className="period-labels">
                    {Array.from({ length: periods[day] }).map((_, pIdx) => (
                      <div key={pIdx} className="period-label">{pIdx+1}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {teachers.map(teacher => (
              <div key={teacher} className="grid-row">
                <div className="grid-time-cell">
                  <div>{teacher}</div>
                  <div style={{fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px'}}>({teacherHours[teacher] || 0}시간)</div>
                </div>
                {DAYS.map(day => (
                  <div key={day} className="grid-cell-group" style={{ flex: periods[day] }}>
                    {Array.from({ length: periods[day] }).map((_, pIdx) => {
                      const period = pIdx + 1;
                      const isDragOver = dragOverCell?.day === day && dragOverCell?.period === period && dragOverCell?.teacher === teacher;
                      return (
                        <div 
                          key={period} 
                          className={`grid-cell ${isDragOver ? 'drag-over' : ''}`}
                          onDragOver={(e) => handleDragOver(e, day, period, teacher)}
                          onDrop={(e) => handleDrop(e, day, period, teacher)}
                        >
                          {renderCellContent(day, period, teacher)}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : viewMode === 'moving_groups' && selectedGrade === 'all' ? (
          <div style={{ overflowX: 'auto', width: '95vw', marginLeft: 'calc(-47.5vw + 50%)', padding: '0 1rem 1rem' }}>
            {/* 두 학년 헤더 */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              <div style={{ width: '80px', flexShrink: 0 }} />
              {['2', '3'].map((g, gIdx) => (
                <div key={g} style={{ flex: 1, minWidth: 0, borderLeft: gIdx > 0 ? '3px solid var(--border)' : 'none' }}>
                  <h3 style={{ textAlign: 'center', margin: '0 0 0.5rem', padding: '0.5rem 0', color: g === '2' ? '#60a5fa' : '#34d399', fontSize: '1rem' }}>
                    {g}학년 이동그룹
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '2px solid var(--border)' }}>
                    {DAYS.map(day => (
                      <div key={day} className="grid-header-cell" style={{ textAlign: 'center' }}>{day}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* 교시별 동기화 행: 같은 div 안에 두 학년을 나란히 → 행 높이 자동 동기화 */}
            {Array.from({ length: maxPeriods }).map((_, pIdx) => {
              const period = pIdx + 1;
              return (
                <div key={period} style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)' }}>
                  <div className="grid-time-cell" style={{ width: '80px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {period}교시
                  </div>
                  {['2', '3'].map((g, gIdx) => (
                    <div key={g} style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderLeft: gIdx > 0 ? '3px solid var(--border)' : 'none' }}>
                      {DAYS.map(day => {
                        const isValidPeriod = period <= periods[day];
                        const isDragOver = dragOverCell?.day === day && dragOverCell?.period === period;
                        return (
                          <div
                            key={day}
                            className={`grid-cell ${!isValidPeriod ? 'disabled' : ''} ${isDragOver ? 'drag-over' : ''}`}
                            style={{ minHeight: '80px' }}
                            onDragOver={(e) => isValidPeriod ? handleDragOver(e, day, period) : e.preventDefault()}
                            onDrop={(e) => isValidPeriod ? handleDrop(e, day, period) : e.preventDefault()}
                          >
                            {isValidPeriod && renderCellContent(day, period, undefined, g)}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="timetable-grid normal-grid">
            <div className="grid-header-row">
              <div className="grid-corner"></div>
              {DAYS.map(day => (
                <div key={day} className="grid-header-cell">{day}</div>
              ))}
            </div>
            {Array.from({ length: maxPeriods }).map((_, pIdx) => {
              const period = pIdx + 1;
              return (
                <div key={period} className="grid-row">
                  <div className="grid-time-cell">{period}교시</div>
                  {DAYS.map(day => {
                    const isValidPeriod = period <= periods[day];
                    const isDragOver = dragOverCell?.day === day && dragOverCell?.period === period;
                    return (
                      <div 
                        key={day} 
                        className={`grid-cell ${!isValidPeriod ? 'disabled' : ''} ${isDragOver ? 'drag-over' : ''}`}
                        onDragOver={(e) => isValidPeriod ? handleDragOver(e, day, period) : e.preventDefault()}
                        onDrop={(e) => isValidPeriod ? handleDrop(e, day, period) : e.preventDefault()}
                      >
                        {isValidPeriod && renderCellContent(day, period)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
