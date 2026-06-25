import React, { useState } from 'react';

export default function GroupPreview({ previewData, onBack, onGenerate, loading, error }: any) {
  const [isMatchedExpanded, setIsMatchedExpanded] = useState(false);
  const [isUnmatchedExpanded, setIsUnmatchedExpanded] = useState(false);
  return (
    <div className="glass-panel" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '1.5rem', color: '#60a5fa' }}>🔍 이동그룹 및 교사 매칭 결과</h2>
      
      {error && (
        <div className="error-card" style={{ marginBottom: '1.5rem' }}>
          <h3>🚨 오류 발생</h3>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{error}</p>
        </div>
      )}

      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-number">{previewData.teachers.length}</div>
          <div className="summary-label">등록된 교사</div>
        </div>
        <div className="summary-card">
          <div className="summary-number">{previewData.total_moving_groups}</div>
          <div className="summary-label">이동그룹 수</div>
        </div>
        <div className="summary-card">
          <div className="summary-number" style={{ color: previewData.unmatched_groups.length > 0 ? '#ef4444' : '#10b981' }}>
            {previewData.unmatched_groups.length}
          </div>
          <div className="summary-label">미매칭 그룹</div>
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', cursor: 'pointer' }} onClick={() => setIsUnmatchedExpanded(!isUnmatchedExpanded)}>
          <h3 style={{ color: '#a78bfa', margin: 0 }}>⚠️ 매칭 실패 이동그룹 ({previewData.unmatched_groups.length}건)</h3>
          {previewData.unmatched_groups.length > 0 && (
            <button type="button" className="action-btn secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.9rem' }}>
              {isUnmatchedExpanded ? '접기 ▲' : '펼쳐보기 ▼'}
            </button>
          )}
        </div>
        
        {previewData.unmatched_groups.length === 0 ? (
          <p style={{ color: '#10b981', padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '0.5rem' }}>
            모든 이동그룹이 교사 시수표와 완벽하게 매칭되었습니다! 🎉
          </p>
        ) : (
          isUnmatchedExpanded && (
            <div className="group-table-wrapper" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <table className="group-table">
                <thead>
                  <tr>
                    <th>학년</th>
                    <th>그룹</th>
                    <th>과목명</th>
                    <th>대상 반</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.unmatched_groups.map((g: any, i: number) => {
                    let rowBg = '';
                    if (g.grade === 1) rowBg = 'rgba(59, 130, 246, 0.1)';
                    else if (g.grade === 2) rowBg = 'rgba(245, 158, 11, 0.1)';
                    else if (g.grade === 3) rowBg = 'rgba(167, 139, 250, 0.1)';
                    
                    return (
                      <tr key={i} style={{ backgroundColor: rowBg }}>
                        <td>{g.grade}학년</td>
                        <td><span className="group-badge warning">{g.group} 그룹</span></td>
                        <td>{g.subject}</td>
                        <td>{g.class_col}반</td>
                        <td><span className="status-badge danger">교사 없음</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#f87171' }}>
                * 위 그룹에 해당하는 교사가 시수표에 없거나 과목명이 다릅니다. 이대로 진행하면 해당 이동수업은 배정되지 않습니다.
              </p>
            </div>
          )
        )}
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', cursor: 'pointer' }} onClick={() => setIsMatchedExpanded(!isMatchedExpanded)}>
          <h3 style={{ color: '#34d399', margin: 0 }}>✅ 매칭 완료 이동그룹 ({previewData.matched_groups.length}건)</h3>
          <button type="button" className="action-btn secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.9rem' }}>
            {isMatchedExpanded ? '접기 ▲' : '펼쳐보기 ▼'}
          </button>
        </div>
        
        {isMatchedExpanded && (
          <div className="group-table-wrapper">
            <table className="group-table">
              <thead>
                <tr>
                  <th>학년</th>
                  <th>그룹</th>
                  <th>과목명 (이동그룹)</th>
                  <th>과목명 (시수표)</th>
                  <th>대상 반</th>
                  <th>담당 교사</th>
                  <th>시수</th>
                </tr>
              </thead>
              <tbody>
                {previewData.matched_groups.map((g: any, i: number) => {
                  let rowBg = '';
                  if (g.grade === 1) rowBg = 'rgba(59, 130, 246, 0.1)';
                  else if (g.grade === 2) rowBg = 'rgba(245, 158, 11, 0.1)';
                  else if (g.grade === 3) rowBg = 'rgba(167, 139, 250, 0.1)';
                  
                  return (
                    <tr key={i} style={{ backgroundColor: rowBg }}>
                      <td>{g.grade}학년</td>
                      <td><span className="group-badge">{g.group} 그룹</span></td>
                      <td>{g.subject}</td>
                      <td>{g.matched_subject}</td>
                      <td>{g.class_col}반</td>
                      <td style={{ fontWeight: 600, color: '#e2e8f0' }}>{g.teacher}</td>
                      <td>{g.hours}시간</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: '#f59e0b' }}>👨‍🏫 교사 목록 및 시수 요약</h3>
        <div className="teacher-grid">
          {previewData.teachers.map((t: any, i: number) => (
            <div key={i} className="teacher-card">
              <div className="teacher-name">{t.teacher}</div>
              <div className="teacher-hours">{t.total_hours}시간</div>
              <div className="teacher-subjects">{t.subjects.join(', ')}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
        <button 
          className="btn-secondary"
          onClick={onBack}
          disabled={loading}
        >
          ← 파일 다시 선택
        </button>
        <button 
          className="btn-primary" 
          style={{ flex: 1 }}
          onClick={onGenerate}
          disabled={loading}
        >
          {loading ? <><span className="loader"></span> 시간표 생성 중...</> : '🚀 이대로 시간표 생성 시작'}
        </button>
      </div>
    </div>
  );
}
