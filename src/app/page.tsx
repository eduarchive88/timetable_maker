'use client';

import React, { useState } from 'react';
import TimetableEditor, { ScheduleItem } from '@/components/TimetableEditor';
import GroupPreview from '@/components/GroupPreview';

// ──────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────
interface MatchedGroup {
  grade: number;
  group: string;
  subject: string;
  class_col: string;
  teacher: string;
  hours: number;
  matched_subject: string;
}

interface UnmatchedGroup {
  grade: number;
  group: string;
  subject: string;
  class_col: string;
}

interface TeacherInfo {
  teacher: string;
  total_hours: number;
  subjects: string[];
}

interface ClassInfo {
  grade: number;
  class_col: string;
}

interface PreviewData {
  matched_groups: MatchedGroup[];
  unmatched_groups: UnmatchedGroup[];
  teachers: TeacherInfo[];
  classes: ClassInfo[];
  total_teacher_records: number;
  total_moving_groups: number;
}

interface StructuredAdvice {
  category: string;
  from_teacher: string;
  from_hours: number;
  to_teacher: string;
  to_hours: number;
  subjects: string[];
  label: string;
}

interface SimulationResult {
  step: number;
  label: string;
  from_teacher: string;
  to_teacher: string;
  category: string;
  status: string;
  conflict_count: number;
  delta: number;
  message: string;
  schedule?: any[];
}

// ──────────────────────────────────────────
// 메인 페이지 컴포넌트
// ──────────────────────────────────────────
export default function Home() {
  // Step 관리 (1: 기초정보, 2: 파일업로드, 3: 이동그룹 확인, 4: 시간표 편집)
  const [currentStep, setCurrentStep] = useState(1);
  
  // Step 1: 기초 정보
  const [periods, setPeriods] = useState({ 월: 6, 화: 7, 수: 7, 목: 7, 금: 6 });
  const [fixedTimeSlots, setFixedTimeSlots] = useState<string[]>([]);
  const [gradeClasses, setGradeClasses] = useState<{ [grade: string]: number }>({
    '1': 10, '2': 10, '3': 10
  });
  const [targetSemester, setTargetSemester] = useState<string>('0'); // '0': 구분없음, '1': 1학기, '2': 2학기
  
  // Step 2: 파일 업로드
  const [files, setFiles] = useState<{ teacher_file: File | null; group_file: File | null }>({
    teacher_file: null,
    group_file: null
  });
  const [dragActive, setDragActive] = useState<{ [key: string]: boolean }>({});
  
  // Step 3: 미리보기 결과
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
  // Step 4: 시간표 결과
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [originalResult, setOriginalResult] = useState<any>(null);
  
  // 시수 조정 제안
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggestionMsg, setSuggestionMsg] = useState<string>('');
  const [structuredAdviceList, setStructuredAdviceList] = useState<StructuredAdvice[]>([]);
  const [showSuggestionsModal, setShowSuggestionsModal] = useState<boolean>(false);
  
  // 시뮬레이션 관련 상태
  const [simulating, setSimulating] = useState(false);
  const [simulationSteps, setSimulationSteps] = useState<StructuredAdvice[]>([]);
  const [simulationResults, setSimulationResults] = useState<{baseline: number, results: SimulationResult[]} | null>(null);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [diffMessages, setDiffMessages] = useState<string[]>([]);

  // ──────────────────────────────────────────
  // 파일 핸들러
  // ──────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    if (e.target.files && e.target.files[0]) {
      setFiles(prev => ({ ...prev, [key]: e.target.files![0] }));
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(prev => ({ ...prev, [key]: true }));
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(prev => ({ ...prev, [key]: false }));
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(prev => ({ ...prev, [key]: false }));
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFiles(prev => ({ ...prev, [key]: e.dataTransfer.files[0] }));
    }
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLInputElement>, day: string) => {
    setPeriods(prev => ({ ...prev, [day]: parseInt(e.target.value) || 0 }));
  };

  // ──────────────────────────────────────────
  // Step 2 → Step 3: 파일 분석 (미리보기)
  // ──────────────────────────────────────────
  const handlePreview = async () => {
    if (!files.teacher_file || !files.group_file) {
      alert('교사별 시수표와 이동그룹 파일을 모두 업로드해주세요.');
      return;
    }
    
    setPreviewLoading(true);
    setPreviewError(null);
    
    const formData = new FormData();
    formData.append('teacher_file', files.teacher_file);
    formData.append('group_file', files.group_file);
    formData.append('grade_classes', JSON.stringify(gradeClasses));
    formData.append('target_semester', targetSemester);
    
    try {
      const res = await fetch('/api/preview', { method: 'POST', body: formData });
      const data = await res.json();
      
      if (data.status === 'success') {
        setPreviewData(data);
        setCurrentStep(3);
      } else {
        setPreviewError(data.message || '파일 분석 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      setPreviewError(err.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ──────────────────────────────────────────
  // Step 3 → Step 4: 시간표 생성
  // ──────────────────────────────────────────
  const handleGenerate = async () => {
    if (!files.teacher_file || !files.group_file) return;
    
    setLoading(true);
    setError(null);
    setWarningMsg(null);
    setResult(null);
    
    const formData = new FormData();
    formData.append('teacher_file', files.teacher_file);
    formData.append('group_file', files.group_file);
    formData.append('periods', JSON.stringify(periods));
    formData.append('fixed_timeslots', JSON.stringify(fixedTimeSlots));
    formData.append('grade_classes', JSON.stringify(gradeClasses));
    formData.append('target_semester', targetSemester);
    
    try {
      const res = await fetch('/api/solve', { method: 'POST', body: formData });
      const data = await res.json();
      
      if (!res.ok || data.status === 'error') {
        setError(data.message || '시간표 생성 중 오류가 발생했습니다.');
      } else if (data.status === 'warning') {
        setWarningMsg(data.message);
        setResult(data);
        setCurrentStep(4);
      } else {
        setResult(data);
        setCurrentStep(4);
      }
    } catch (err: any) {
      setError(err.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────
  // 시수 조정 제안
  // ──────────────────────────────────────────
  const handleSuggestSwaps = async (currentSchedule: ScheduleItem[]) => {
    if (!files.teacher_file || !files.group_file) {
      alert('원본 엑셀 파일(교사별 시수표, 이동그룹)이 등록되지 않았습니다.\n이전 버전의 백업 파일인 경우 1~2단계를 통해 파일을 다시 업로드해주세요.');
      return;
    }
    
    setSuggesting(true);

    const formData = new FormData();
    formData.append('teacher_file', files.teacher_file);
    formData.append('group_file', files.group_file);
    formData.append('periods', JSON.stringify(periods));
    formData.append('fixed_timeslots', JSON.stringify(fixedTimeSlots));
    formData.append('current_schedule', JSON.stringify(currentSchedule));

    try {
      const res = await fetch('/api/suggest', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.status === 'success') {
        setSuggestionMsg(data.message);
        setSuggestions(data.suggestions || []);
        setStructuredAdviceList(data.structured_advice || []);
        setShowSuggestionsModal(true);
      } else {
        alert(data.message || '추천 분석 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      alert('네트워크 오류가 발생했습니다.');
    } finally {
      setSuggesting(false);
    }
  };

  // ──────────────────────────────────────────
  // 시뮬레이션
  // ──────────────────────────────────────────
  const handleSimulate = async (advice: StructuredAdvice) => {
    if (!files.teacher_file) {
      alert('원본 엑셀 파일이 필요합니다.');
      return;
    }
    
    const newSteps = [...simulationSteps, advice];
    setSimulationSteps(newSteps);
    setSimulating(true);

    const formData = new FormData();
    formData.append('teacher_file', files.teacher_file);
    if (files.group_file) formData.append('group_file', files.group_file);
    formData.append('periods', JSON.stringify(periods));
    formData.append('fixed_timeslots', JSON.stringify(fixedTimeSlots));
    formData.append('current_schedule', JSON.stringify(result?.schedule || []));
    formData.append('steps', JSON.stringify(newSteps));

    try {
      const res = await fetch('/api/simulate', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.status === 'success') {
        setSimulationResults({ baseline: data.baseline_conflicts, results: data.results });
      } else {
        alert(data.message || '시뮬레이션 중 오류가 발생했습니다.');
      }
    } catch (err) {
      alert('네트워크 오류가 발생했습니다.');
    } finally {
      setSimulating(false);
    }
  };

  const handleResetSimulation = () => {
    setSimulationSteps([]);
    setSimulationResults(null);
  };

  const getScheduleDifferences = (oldSchedule: any[], newSchedule: any[]) => {
    const getCounts = (sched: any[]) => {
      const counts: any = {};
      sched.forEach(item => {
        const key = item.group 
          ? `[${item.grade}학년 이동 ${item.group}] ${item.subject}`
          : `[${item.grade}학년 ${item.class_col}반] ${item.subject}`;
        if (!counts[key]) counts[key] = {};
        counts[key][item.teacher] = (counts[key][item.teacher] || 0) + 1;
      });
      return counts;
    };
    
    const oldC = getCounts(oldSchedule);
    const newC = getCounts(newSchedule);
    const diffs: string[] = [];
    const allKeys = new Set([...Object.keys(oldC), ...Object.keys(newC)]);
    
    allKeys.forEach(key => {
      const oT = oldC[key] || {};
      const nT = newC[key] || {};
      const lost: any = {};
      const gained: any = {};
      const allTeachers = new Set([...Object.keys(oT), ...Object.keys(nT)]);
      
      allTeachers.forEach(t => {
        const diff = (nT[t] || 0) - (oT[t] || 0);
        if (diff < 0) lost[t] = -diff;
        if (diff > 0) gained[t] = diff;
      });
      
      Object.keys(lost).forEach(lT => {
        Object.keys(gained).forEach(gT => {
          const transfer = Math.min(lost[lT], gained[gT]);
          if (transfer > 0) {
            diffs.push(`${key}: ${lT} ➡️ ${gT} (${transfer}시간 이관)`);
            lost[lT] -= transfer;
            gained[gT] -= transfer;
          }
        });
      });
    });
    return diffs;
  };

  const handleApplySimulation = (res: SimulationResult) => {
    if (!res.schedule) return;
    if (!originalResult) {
      setOriginalResult(result);
    }
    setResult({ ...result, schedule: res.schedule });
    setShowSuggestionsModal(false); 
    if (res.conflict_count === 0) {
      setWarningMsg(null);
    }
    alert(`시뮬레이션 결과가 편집기에 적용되었습니다. (Step ${res.step})`);
  };

  const handleRevertOriginal = () => {
    if (originalResult) {
      setResult(originalResult);
      setOriginalResult(null);
      alert('원본 시간표로 되돌렸습니다.');
    }
  };

  // ──────────────────────────────────────────
  // 엑셀 다운로드
  // ──────────────────────────────────────────
  const handleDownloadTeacher = async () => {
    if (!result || !result.schedule) return;
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: result.schedule, periods })
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'teacher_timetable.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('전체 교사 시간표 엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  const handleDownloadClass = async () => {
    if (!result || !result.schedule) return;
    
    const classList = result.classes || previewData?.classes || 
      Array.from(new Set(result.schedule.filter(s => s.grade && s.class_col).map(s => `${s.grade}-${s.class_col}`)))
        .map(str => {
          const [g, c] = str.split('-');
          return { grade: parseInt(g), class_col: c };
        });

    try {
      const res = await fetch('/api/download_class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: result.schedule, periods, classes: classList })
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'class_timetables.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('학급별 시간표 엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  const handleDownloadTeacherGrid = async () => {
    if (!result || !result.schedule) return;
    try {
      const res = await fetch('/api/download_teacher_grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: result.schedule, periods })
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'teacher_personal_timetables.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('교사 개인 시간표 엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  // ──────────────────────────────────────────
  // 재생성 기능 (고급 옵션)
  // ──────────────────────────────────────────
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState({
    distribute_teachers_evenly: true,
    min_one_hour_per_day: true,
    avoid_3_consecutive_classes: true,
    avoid_block_classes: true
  });
  const handleRegenerate = async (options: { distribute_teachers_evenly: boolean, min_one_hour_per_day: boolean, avoid_3_consecutive_classes: boolean, avoid_block_classes: boolean }) => {
    if (!files.teacher_file || !files.group_file) {
      alert('원본 엑셀 파일(교사별 시수표, 이동그룹)이 등록되지 않았습니다.\n이전 버전의 백업 파일인 경우 1~2단계를 통해 파일을 다시 업로드해주세요.');
      return;
    }
    setIsRegenerating(true);
    setWarningMsg(null);
    setError(null);
    
    const formData = new FormData();
    formData.append('teacher_file', files.teacher_file);
    formData.append('group_file', files.group_file);
    formData.append('periods', JSON.stringify(periods));
    formData.append('fixed_timeslots', JSON.stringify(fixedTimeSlots));
    formData.append('target_semester', targetSemester);
    formData.append('advanced_options', JSON.stringify(options));
    
    try {
      const res = await fetch('/api/solve', { method: 'POST', body: formData });
      const data = await res.json();
      
      if (data.status === 'success' || data.status === 'warning') {
        setResult(data);
        if (data.status === 'warning') setWarningMsg(data.message);
      } else {
        alert(data.message || '시간표 재생성 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      alert('네트워크 오류가 발생했습니다.');
    } finally {
      setIsRegenerating(false);
    }
  };

  // ──────────────────────────────────────────
  // 파일 업로드 렌더링
  // ──────────────────────────────────────────
  const renderFileInput = (label: string, key: string, description: string) => (
    <div className="form-group">
      <label>{label}</label>
      <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem' }}>{description}</p>
      <div 
        className={`file-input-wrapper ${dragActive[key] ? 'drag-active' : ''}`}
        onDragEnter={(e) => handleDragEnter(e, key)}
        onDragLeave={(e) => handleDragLeave(e, key)}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, key)}
      >
        <div className="file-btn">
          {files[key as keyof typeof files] ? `📄 ${files[key as keyof typeof files]!.name}` : '📁 파일을 클릭하거나 여기로 드래그하세요'}
        </div>
        <input type="file" accept=".xls,.xlsx" onChange={(e) => handleFileChange(e, key)} />
      </div>
    </div>
  );

  // ──────────────────────────────────────────
  // 백업 및 복원
  // ──────────────────────────────────────────
  const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });

  const handleBackup = async () => {
    if (!result) return;
    
    let teacherFileBase64 = null;
    let groupFileBase64 = null;
    let teacherFileName = '';
    let groupFileName = '';
    
    if (files.teacher_file) {
      try { teacherFileBase64 = await toBase64(files.teacher_file); teacherFileName = files.teacher_file.name; } catch(e) {}
    }
    if (files.group_file) {
      try { groupFileBase64 = await toBase64(files.group_file); groupFileName = files.group_file.name; } catch(e) {}
    }

    const backupData = {
      periods,
      fixedTimeSlots,
      gradeClasses,
      targetSemester,
      result,
      teacherFileBase64,
      groupFileBase64,
      teacherFileName,
      groupFileName
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timetable_backup.json';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.result && data.periods) {
          setPeriods(data.periods);
          setFixedTimeSlots(data.fixedTimeSlots || []);
          if (data.gradeClasses) setGradeClasses(data.gradeClasses);
          if (data.targetSemester) setTargetSemester(data.targetSemester);
          setResult(data.result);
          
          const newFiles: { teacher_file: File | null, group_file: File | null } = { teacher_file: null, group_file: null };
          
          if (data.teacherFileBase64 && data.teacherFileName) {
            const res = await fetch(data.teacherFileBase64);
            const blob = await res.blob();
            newFiles.teacher_file = new File([blob], data.teacherFileName, { type: blob.type });
          }
          if (data.groupFileBase64 && data.groupFileName) {
            const res = await fetch(data.groupFileBase64);
            const blob = await res.blob();
            newFiles.group_file = new File([blob], data.groupFileName, { type: blob.type });
          }
          setFiles(newFiles);

          setCurrentStep(4);
        } else {
          alert('올바른 백업 파일이 아닙니다.');
        }
      } catch (err) {
        alert('백업 파일을 읽는 중 오류가 발생했습니다.');
      }
    };
    reader.readAsText(file);
    // Reset input value so the same file can be selected again
    e.target.value = '';
  };

  // ──────────────────────────────────────────
  // 스텝 인디케이터
  // ──────────────────────────────────────────
  const steps = [
    { num: 1, label: '기초 정보' },
    { num: 2, label: '파일 업로드' },
    { num: 3, label: '이동그룹 확인' },
    { num: 4, label: '시간표 편집' }
  ];

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <select 
          onChange={(e) => document.documentElement.setAttribute('data-theme', e.target.value)}
          style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', background: 'var(--panel-bg)', color: 'var(--text-main)', border: '1px solid var(--border)', fontSize: '0.9rem', cursor: 'pointer' }}
        >
          <option value="dark">어두운 테마 (기본)</option>
          <option value="light">밝은 테마</option>
          <option value="blue">푸른 테마</option>
          <option value="green">자연 테마</option>
        </select>
      </div>

      <header className="header">
        <h1>고교학점제 맞춤형 시간표 생성기</h1>
        <p>OR-Tools 기반 최적화 스케줄링 · 이동그룹 자동 인식</p>
      </header>

      {/* Step Indicator */}
      <div className="step-indicator">
        {steps.map((step, idx) => (
          <React.Fragment key={step.num}>
            <div 
              className={`step-item ${currentStep === step.num ? 'active' : ''} ${currentStep > step.num ? 'completed' : ''}`}
              onClick={() => {
                // 완료된 단계만 돌아갈 수 있음
                if (step.num < currentStep) setCurrentStep(step.num);
              }}
            >
              <div className="step-circle">
                {currentStep > step.num ? '✓' : step.num}
              </div>
              <span className="step-label">{step.label}</span>
            </div>
            {idx < steps.length - 1 && <div className={`step-line ${currentStep > step.num ? 'completed' : ''}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: 기초 정보 */}
      {currentStep === 1 && (
        <div className="glass-panel step-content" style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ color: '#60a5fa', margin: 0 }}>📋 기초 정보 설정</h2>
            <div>
              <input 
                type="file" 
                accept=".json" 
                id="restore-file" 
                style={{ display: 'none' }} 
                onChange={handleRestore} 
              />
              <button 
                className="btn" 
                style={{ background: '#3b82f6', color: 'white', padding: '0.5rem 1rem', borderRadius: '4px' }}
                onClick={() => document.getElementById('restore-file')?.click()}
              >
                💾 기존 백업 파일 불러오기
              </button>
            </div>
          </div>
          
          <h3 style={{ marginBottom: '1rem', color: '#a78bfa' }}>배정 학기 선택</h3>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
            이동그룹 파일에 1학기/2학기가 나뉘어 있는 경우, 배정할 학기를 선택하세요.
          </p>
          <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.5rem' }}>
            <button
              className={`slot-btn ${targetSemester === '0' ? 'active' : ''}`}
              onClick={() => setTargetSemester('0')}
              style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', border: '1px solid #4b5563', backgroundColor: targetSemester === '0' ? '#3b82f6' : '#1f2937', color: 'white', flex: 1 }}
            >
              학년도 전체
            </button>
            <button
              className={`slot-btn ${targetSemester === '1' ? 'active' : ''}`}
              onClick={() => setTargetSemester('1')}
              style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', border: '1px solid #4b5563', backgroundColor: targetSemester === '1' ? '#3b82f6' : '#1f2937', color: 'white', flex: 1 }}
            >
              1학기
            </button>
            <button
              className={`slot-btn ${targetSemester === '2' ? 'active' : ''}`}
              onClick={() => setTargetSemester('2')}
              style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', border: '1px solid #4b5563', backgroundColor: targetSemester === '2' ? '#3b82f6' : '#1f2937', color: 'white', flex: 1 }}
            >
              2학기
            </button>
          </div>

          <h3 style={{ marginBottom: '1rem', color: '#a78bfa' }}>학년별 반 수</h3>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
            실제 반 수를 입력하세요. 시수표에 이보다 큰 반 번호가 있으면 이동그룹에 의해 생긴 가상학급으로 자동 판별됩니다.
          </p>
          <div className="periods-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {['1', '2', '3'].map(grade => (
              <div key={grade} className="period-item">
                <label>{grade}학년</label>
                <input 
                  type="number" min="1" max="20"
                  value={gradeClasses[grade]}
                  onChange={(e) => setGradeClasses(prev => ({ ...prev, [grade]: parseInt(e.target.value) || 0 }))}
                />
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: '2rem', marginBottom: '1rem', color: '#34d399' }}>요일별 교시 수</h3>
          <div className="periods-grid">
            {Object.keys(periods).map((day) => (
              <div key={day} className="period-item">
                <label>{day}요일</label>
                <input 
                  type="number" min="1" max="10" 
                  value={periods[day as keyof typeof periods]} 
                  onChange={(e) => handlePeriodChange(e, day)}
                />
              </div>
            ))}
          </div>
          
          <h3 style={{ marginTop: '2rem', marginBottom: '1rem', color: '#f59e0b' }}>고정 시간표 (창체 등)</h3>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
            창체, 자습 등 고정된 시간을 클릭해서 잠그세요. 잠긴 시간에는 수업이 배정되지 않습니다.
          </p>
          <div className="fixed-grid">
            <div></div>
            {Object.keys(periods).map(day => (
              <div key={day} className="fixed-grid-header">{day}</div>
            ))}
            {Array.from({length: Math.max(...Object.values(periods))}).map((_, pIdx) => (
              <React.Fragment key={pIdx}>
                <div className="fixed-grid-label">{pIdx + 1}교시</div>
                {Object.keys(periods).map(day => {
                  const isValid = pIdx < (periods as any)[day];
                  const ts = `${day}_${pIdx + 1}`;
                  const isFixed = fixedTimeSlots.includes(ts);
                  return (
                    <div 
                      key={ts}
                      className={`fixed-grid-cell ${isFixed ? 'locked' : ''} ${!isValid ? 'disabled' : ''}`}
                      onClick={() => {
                        if (!isValid) return;
                        setFixedTimeSlots(prev => prev.includes(ts) ? prev.filter(x => x !== ts) : [...prev, ts]);
                      }}
                    >
                      {isValid ? (isFixed ? '🔒' : '') : ''}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          <button 
            className="btn-primary" 
            style={{ marginTop: '2rem' }}
            onClick={() => setCurrentStep(2)}
          >
            다음 단계 →
          </button>
        </div>
      )}

      {/* Step 2: 파일 업로드 */}
      {currentStep === 2 && (
        <div className="glass-panel step-content" style={{ maxWidth: '700px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ color: '#60a5fa', margin: 0 }}>📂 엑셀 파일 업로드</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <a href="/api/download_sample_teacher" className="btn" style={{ background: '#4b5563', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.85rem', textDecoration: 'none' }}>
                ⬇️ 시수표 샘플
              </a>
              <a href="/api/download_sample_group" className="btn" style={{ background: '#4b5563', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.85rem', textDecoration: 'none' }}>
                ⬇️ 이동그룹 샘플
              </a>
            </div>
          </div>
          
          {renderFileInput(
            '① 교사별 시수표', 
            'teacher_file',
            '교과별 시수를 하나의 엑셀로 통합한 파일 (교과명·교사명·시수·학년·반 정보 포함)'
          )}
          {renderFileInput(
            '② 이동그룹 편성표', 
            'group_file',
            '학년별 이동 수업 그룹 구성 파일 (A~H그룹 등)'
          )}
          
          {previewError && (
            <div className="error-card" style={{ marginTop: '1rem' }}>
              <h3>🚨 파일 분석 오류</h3>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{previewError}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button 
              className="btn-secondary"
              onClick={() => setCurrentStep(1)}
            >
              ← 이전
            </button>
            <button 
              className="btn-primary" 
              style={{ flex: 1 }}
              disabled={!files.teacher_file || !files.group_file || previewLoading}
              onClick={handlePreview}
            >
              {previewLoading ? <><span className="loader"></span> 파일 분석 중...</> : '📊 파일 분석 및 이동그룹 인식'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: 이동그룹 확인 */}
      {currentStep === 3 && previewData && (
        <div className="step-content">
          <GroupPreview 
            previewData={previewData}
            onBack={() => setCurrentStep(2)}
            onGenerate={handleGenerate}
            loading={loading}
            error={error}
          />
        </div>
      )}

      {/* Step 4: 시간표 편집 */}
      {currentStep === 4 && (
        <div className="step-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {originalResult && (
                <>
                  <button 
                    className="btn" 
                    style={{ background: '#10b981', color: 'white', padding: '0.5rem 1rem', borderRadius: '4px' }}
                    onClick={() => {
                      const diffs = getScheduleDifferences(originalResult.schedule, result.schedule);
                      setDiffMessages(diffs);
                      setShowDiffModal(true);
                    }}
                  >
                    📊 시수 조정 전/후 비교
                  </button>
                  <button 
                    className="btn" 
                    style={{ background: '#ef4444', color: 'white', padding: '0.5rem 1rem', borderRadius: '4px' }}
                    onClick={handleRevertOriginal}
                  >
                    ↩️ 원본 시간표로 되돌리기
                  </button>
                </>
              )}
            </div>
            <button 
              className="btn" 
              style={{ background: '#3b82f6', color: 'white', padding: '0.5rem 1rem', borderRadius: '4px' }}
              onClick={handleBackup}
            >
              💾 현재 상태 백업 다운로드 (.json)
            </button>
          </div>
          
          {warningMsg && (
            <details className="error-card" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: '1rem', cursor: 'pointer', padding: '1rem', borderRadius: '8px' }}>
              <summary style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '1.1rem' }}>⚠️ 시간표 충돌 경고 (클릭하여 매칭 실패 목록 보기)</summary>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#fcd34d', marginTop: '1rem' }}>{warningMsg}</p>
            </details>
          )}

          {result && (
            <TimetableEditor 
              initialSchedule={result.schedule} 
              periods={periods}
              onDownloadTeacher={handleDownloadTeacher}
              onDownloadClass={handleDownloadClass}
              onDownloadTeacherGrid={handleDownloadTeacherGrid}
              onSuggestSwaps={handleSuggestSwaps}
              isSuggesting={suggesting}
              hasPreviousSuggestions={suggestions !== null}
              onViewPreviousSuggestions={() => setShowSuggestionsModal(true)}
              onRegenerate={handleRegenerate}
              isRegenerating={isRegenerating}
            />
          )}
          
          {/* 시수 조정 제안 모달 */}
          {showSuggestionsModal && (
            <div className="modal-overlay" onClick={() => setShowSuggestionsModal(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h3 style={{ marginBottom: '1rem', color: '#60a5fa' }}>💡 AI 시수 분석 & 교환 제안</h3>
                <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '10px' }}>
                  
                  {/* 구조화된 조언 목록 (시뮬레이션 버튼 포함) */}
                  {structuredAdviceList.length > 0 ? (
                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {structuredAdviceList.map((adv, i) => {
                          const isAlreadyAdded = simulationSteps.some(s => s.label === adv.label);
                          return (
                            <div key={i} style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 'bold', color: '#e2e8f0' }}>{adv.label}</div>
                                <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>과목: {adv.subjects.join(', ')}</div>
                              </div>
                              <button 
                                className="btn" 
                                style={{ background: isAlreadyAdded ? '#475569' : '#8b5cf6', color: 'white', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                                onClick={() => handleSimulate(adv)}
                                disabled={simulating || isAlreadyAdded}
                              >
                                {isAlreadyAdded ? '✅ 적용됨' : '적용하여 시뮬레이션'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: '#94a3b8' }}>추천 시수 조정 방안이 없습니다.</p>
                  )}

                  {/* 시뮬레이션 진행 상황 및 결과 표시 */}
                  {simulating && (
                    <div style={{ marginTop: '2rem', textAlign: 'center', padding: '2rem', background: '#0f172a', borderRadius: '8px' }}>
                      <div className="loader" style={{ marginBottom: '1rem' }}></div>
                      <div style={{ color: '#94a3b8' }}>시뮬레이션을 진행 중입니다... (1~2분 소요될 수 있습니다)</div>
                    </div>
                  )}

                  {simulationResults && !simulating && (
                    <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: '8px', border: '1px solid #334155' }}>
                      <h4 style={{ color: '#34d399', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>📊 시뮬레이션 결과 (초기 충돌: {simulationResults.baseline}건)</span>
                        <button onClick={handleResetSimulation} style={{ background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}>초기화</button>
                      </h4>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {simulationResults.results.map((res, i) => (
                          <div key={i} style={{ 
                            padding: '1rem', 
                            background: res.status === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            borderLeft: `4px solid ${res.status === 'success' ? '#10b981' : '#ef4444'}`,
                            borderRadius: '4px'
                          }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                              Step {res.step}. {res.label}
                            </div>
                            {res.status === 'success' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#e2e8f0' }}>예상 충돌 수: <strong style={{ color: res.conflict_count === 0 ? '#34d399' : '#fbbf24' }}>{res.conflict_count}건</strong></span>
                                {res.delta > 0 && <span style={{ color: '#34d399', fontSize: '0.9rem' }}>(▼{res.delta} 감소)</span>}
                                {res.delta < 0 && <span style={{ color: '#ef4444', fontSize: '0.9rem' }}>(▲{Math.abs(res.delta)} 증가)</span>}
                                {res.conflict_count === 0 && <span style={{ marginLeft: 'auto' }}>✅ 시간표 완성 가능!</span>}
                                <button 
                                  className="btn" 
                                  style={{ background: '#3b82f6', color: 'white', padding: '0.3rem 0.6rem', fontSize: '0.8rem', marginLeft: res.conflict_count !== 0 ? 'auto' : '0.5rem' }}
                                  onClick={() => handleApplySimulation(res)}
                                >
                                  현재 편집기에 반영하기
                                </button>
                              </div>
                            ) : (
                              <div style={{ color: '#f87171', fontSize: '0.9rem' }}>오류: {res.message}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                  <button 
                    onClick={() => setShowSuggestionsModal(false)}
                    style={{ flex: 1 }}
                    className="btn-primary"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 시수 조정 비교 모달 */}
          {showDiffModal && (
            <div className="modal-overlay" onClick={() => setShowDiffModal(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h3 style={{ marginBottom: '1rem', color: '#10b981' }}>📊 시수 조정 전/후 비교 내역</h3>
                <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  {diffMessages.length > 0 ? (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {diffMessages.map((msg, i) => (
                        <li key={i} style={{
                          background: 'rgba(255,255,255,0.05)',
                          padding: '1rem',
                          marginBottom: '0.5rem',
                          borderRadius: '8px',
                          borderLeft: '4px solid #3b82f6',
                          lineHeight: '1.6'
                        }}>
                          {msg}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ color: '#94a3b8' }}>변경된 시수 내역이 없습니다.</p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                  <button 
                    onClick={() => setShowDiffModal(false)}
                    style={{ flex: 1 }}
                    className="btn-primary"
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button 
              className="btn-secondary"
              onClick={() => setCurrentStep(3)}
            >
              ← 이동그룹 확인으로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
