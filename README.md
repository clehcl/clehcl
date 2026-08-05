# 🥬 식자재 클리핑

F&B·식자재 시장 뉴스를 카테고리 보드로 모아 보는 뉴스 클리핑 페이지.
설정한 키워드로 뉴스를 **자동 수집 → 분류 → 화면 갱신**합니다.

## 구조

```
config/keywords.json        ①  카테고리별 검색어 + 분류·제외 규칙  (튜닝은 이 파일만 수정)
collector/fetch.mjs         ③  네이버 뉴스 API 수집 → data/news.json 생성
data/news.json                 수집 결과 (지금은 실제 기사로 시드되어 있음)
index.html                  ③  news.json 을 읽어 렌더 + 주기적 자동 새로고침
.github/workflows/collect.yml  ③  스케줄러: 주기적으로 수집 후 커밋
```

- **①  검색어·카테고리 튜닝** 과 **③  자동 수집·갱신** 이 한 파이프라인으로 연결됩니다.
- 카테고리: `외식·프랜차이즈 / 식자재·원가 / 유통·물류 / 물가·정책 / 신제품·트렌드`

## 로컬에서 보기

정적 파일이므로 서버로 열기만 하면 됩니다. (시드 데이터로 바로 동작)

```bash
python3 -m http.server 8080   # 또는  npm run serve
# 브라우저에서 http://localhost:8080
```

## 실제 뉴스 수집하기

네이버 검색 오픈 API 키가 필요합니다 → https://developers.naver.com/apps

```bash
cp .env.example .env          # 키 입력
NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy npm run collect
```

`collector/fetch.mjs` 가 `config/keywords.json` 의 카테고리별 검색어로 뉴스를 받아
제외/필수 규칙으로 거른 뒤 `data/news.json` 을 새로 씁니다. 키가 없으면 수집을
건너뛰고 기존 데이터를 유지합니다.

## 자동 수집 (GitHub Actions)

1. 저장소 **Settings → Secrets and variables → Actions** 에
   `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 등록
2. `.github/workflows/collect.yml` 이 30분마다(조정 가능) 수집 후 `data/news.json` 을 커밋
3. **Settings → Pages** 에서 이 브랜치를 소스로 지정하면, 데이터가 갱신될 때마다
   사이트가 자동으로 최신 뉴스로 새로고침됩니다

## 검색어·카테고리 튜닝 (①)

`config/keywords.json` 만 고치면 됩니다.

- `categories[].queries` — 각 카테고리에서 검색할 키워드(여러 개)
- `categories[].boost` — 있으면 상단 노출 가점 + 카드 태그로 사용
- `global.exclude` — 이 단어가 들어간 기사는 노이즈로 제외 (예: 화장품·의약품)
- `global.require` — 이 중 하나라도 있어야 식품 관련 기사로 채택
- `site.perCategory` — 카테고리당 카드 수, `site.refreshMinutes` — 화면 자동 새로고침 주기

## 화면에서 키워드 바꾸기

상단 **키워드 관리** 패널에서 키워드를 그룹으로 정리하고 🔔 알림 표시를 켤 수 있습니다.
이 값은 브라우저에 저장되어 **화면 필터/표시**에 쓰입니다. 서버가 **실제로 수집하는**
검색어를 바꾸려면 `config/keywords.json` 을 수정하세요.
