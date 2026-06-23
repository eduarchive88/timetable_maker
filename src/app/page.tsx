'use client';

import { useState } from 'react';

export default function Home() {
  const [files, setFiles] = useState<{ [key: string]: File | null }>({
    teacher_file: null,
    g2_file: null,
    g3_file: null,
    group_file: null
  });
  
  const [dragActive, setDragActive] = useState<{ [key: string]: boolean }>({});

  const [periods, setPeriods] = useState({
    월: 7, 화: 7, 수: 6, 목: 7, 금: 6
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    if (e.target.files && e.target.files[0]) {
      setFiles(prev => ({ ...prev, [key]: e.target.files![0] }));
    }
  };

  // Drag and Drop handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(prev => ({ ...prev, [key]: true }));
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(prev => ({ ...prev, [key]: false }));
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(prev => ({ ...prev, [key]: false }));
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFiles(prev => ({ ...prev, [key]: e.dataTransfer.files[0] }));
    }
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLInputElement>, day: string) => {
    setPeriods(prev => ({ ...prev, [day]: parseInt(e.target.value) || 0 }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    
    if (!files.teacher_file || !files.g2_file || !files.g3_file || !files.group_file) {
      setError('4개의 엑셀 파일을 모두 업로드해주세요.');
      return;
    }

    setLoading(true);
    
    const formData = new FormData();
    Object.keys(files).forEach(key => {
      if (files[key]) formData.append(key, files[key] as Blob);
    });
    formData.append('periods', JSON.stringify(periods));

    try {
      const res = await fetch('/api/solve', {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();
      if (!res.ok || data.status === 'error') {
        setError(data.message || '시간표 생성 중 오류가 발생했습니다.');
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

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
      alert('교사 시간표 엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  const handleDownloadStudent = async () => {
    if (!result || !result.schedule || !result.students) {
      alert('학생 시간표 데이터가 존재하지 않습니다.');
      return;
    }
    
    try {
      const res = await fetch('/api/download_student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: result.schedule, students: result.students, periods })
      });
      
      if (!res.ok) throw new Error('다운로드 실패');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'student_timetables.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('학생 시간표 엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  const renderFileInput = (label: string, key: string) => (
    <div className="form-group">
      <label>{label}</label>
      <div 
        className={`file-input-wrapper ${dragActive[key] ? 'drag-active' : ''}`}
        onDragEnter={(e) => handleDragEnter(e, key)}
        onDragLeave={(e) => handleDragLeave(e, key)}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, key)}
      >
        <div className="file-btn">
          {files[key] ? `📄 ${files[key]!.name}` : '📁 파일을 클릭하거나 여기로 드래그하세요'}
        </div>
        <input type="file" accept=".xls,.xlsx" onChange={(e) => handleFileChange(e, key)} />
      </div>
    </div>
  );

  return (
    <div className="container">
      <header className="header">
        <h1>지능형 시간표 생성기</h1>
        <p>OR-Tools 기반 최적화 스케줄링 및 교사별 시수표 자동 매핑</p>
      </header>

      <div className="grid-2">
        <div className="glass-panel">
          <h2 style={{ marginBottom: '1.5rem', color: '#60a5fa' }}>1. 엑셀 파일 업로드</h2>
          <form onSubmit={handleSubmit}>
            
            {renderFileInput('교사별 시수표', 'teacher_file')}
            {renderFileInput('2학년 학급편성', 'g2_file')}
            {renderFileInput('3학년 학급편성', 'g3_file')}
            {renderFileInput('이동그룹', 'group_file')}

            <h2 style={{ marginTop: '2.5rem', marginBottom: '1.5rem', color: '#34d399' }}>2. 요일별 교시 설정</h2>
            <div className="periods-grid">
              {Object.keys(periods).map((day) => (
                <div key={day} className="period-item">
                  <label>{day}요일</label>
                  <input 
                    type="number" 
                    min="1" max="10" 
                    value={periods[day as keyof typeof periods]} 
                    onChange={(e) => handlePeriodChange(e, day)}
                  />
                </div>
              ))}
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <><span className="loader"></span> 시간표 분석 및 생성 중...</> : '✨ 시간표 생성 시작'}
            </button>
          </form>
        </div>

        <div>
          {error && (
            <div className="error-card">
              <h3>🚨 생성 불가</h3>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{error}</p>
            </div>
          )}

          {result && (
            <div className="glass-panel result-section">
              <h2 style={{ color: '#10b981', marginBottom: '1rem' }}>🎉 생성 완료!</h2>
              <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                성공적으로 모든 시간표 배정이 완료되었습니다. 교사별/학생별 시간표를 엑셀로 다운로드하여 확인하세요.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button onClick={handleDownloadTeacher} className="btn-success">
                  👨‍🏫 교사별 시간표 다운로드 (.xlsx)
                </button>
                <button onClick={handleDownloadStudent} className="btn-success" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}>
                  🎓 학생별 개인 시간표 다운로드 (.xlsx)
                </button>
              </div>
              
              <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#60a5fa' }}>통계</h3>
                <ul style={{ listStyle: 'none', color: '#cbd5e1' }}>
                  <li>배정된 총 수업 블록: {result.schedule.length} 개</li>
                  {result.students && <li>분석된 학생 수: {result.students.length} 명</li>}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
