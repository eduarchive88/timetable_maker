import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '지능형 시간표 생성기',
  description: '경기도 지구과학 교사 뀨짱이 만든 OR-Tools 기반 고등학교 시간표 생성기',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
        
        <footer className="footer">
          <p>만든 사람: 경기도 지구과학 교사 뀨짱</p>
          <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center', gap: '1.5rem' }}>
            <a href="https://open.kakao.com/o/s7hVU65h" target="_blank" rel="noopener noreferrer">
              💬 문의: 카카오톡 오픈채팅
            </a>
            <a href="https://eduarchive.tistory.com/" target="_blank" rel="noopener noreferrer">
              📚 블로그: 뀨짱쌤의 교육자료 아카이브
            </a>
          </div>
        </footer>
      </body>
    </html>
  )
}
