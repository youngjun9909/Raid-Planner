# 로아 레이드 공대 짜기

## 무엇을 하는 도구인가요

친구들의 로스트아크 원정대를 한 번 등록해 두면, 레이드를 고를 때 **이번 주에 아직 안 간 캐릭터**로 공대 후보를 자동으로 짜 줘요. 웹 화면과 디스코드 슬래시 명령어(`/공대` 등)로 모두 쓸 수 있고, 클리어 기록은 매주 수요일 06:00(KST)에 새로 시작해요. 친구 5명 안팎이 쓰는 것을 기준으로 만들었어요.

## 준비물

- 로스트아크를 하는 계정 (Stove 로그인)
- 디스코드 계정과, 봇을 초대할 수 있는 서버(관리 권한)
- GitHub 계정 (Vercel에 코드를 올리는 데 편해요)
- 무료로 가입할 수 있는 서비스: Vercel, Upstash
- PC에 Node.js (로컬 실행/명령어 등록용)

> 메뉴 이름이나 화면 배치는 각 서비스가 바꿀 수 있어요. 아래 설명과 조금 다르면 비슷한 이름의 메뉴를 찾아보세요.

## 1. 로스트아크 API 토큰 발급

1. <https://developer-lostark.game.onstove.com> 에 접속해 Stove 계정으로 로그인해요.
2. 클라이언트(API 사용 신청)를 새로 만들어요. 이름과 용도는 자유롭게 적어도 돼요.
3. 만들어지면 긴 문자열(JWT)이 나와요. 이것을 복사해 두세요. 이것이 `LOSTARK_JWT` 예요.

참고: 요청할 때는 `authorization: bearer <JWT>` 헤더를 쓰고(이 앱이 알아서 해요), 토큰은 삭제하지 않는 한 만료되지 않아요. 남에게 보여 주면 안 돼요.

## 2. 디스코드 앱 만들기

1. <https://discord.com/developers/applications> 에서 **New Application**을 눌러 이름을 정해요.
2. **General Information** 화면에서 두 값을 복사해 둬요.
   - **Application ID** → `DISCORD_APP_ID`
   - **Public Key** → `DISCORD_PUBLIC_KEY`
3. 왼쪽 **Bot** 탭에서 **Reset Token**을 눌러 나온 토큰을 복사해요 → `DISCORD_BOT_TOKEN`. 이 토큰은 다시 볼 수 없으니 바로 저장하세요.
4. 서버에 초대하기: **OAuth2** → **URL Generator**에서 스코프를 고르고, 아래에 만들어진 URL을 브라우저에 붙여 넣어 서버를 선택해요.
   - `applications.commands` : **필수**. 서버에서 슬래시 명령어를 쓰려면 필요해요.
   - `bot` : 선택. 이 앱은 디스코드에 접속해 있는 방식이 아니라, 명령어가 쓰일 때 디스코드가 우리 주소로 요청을 보내 주는 방식이라 없어도 동작해요. 멤버 목록에 봇이 보이길 원할 때만 추가하세요(권한은 필요 없어요).

## 3. Upstash Redis 만들기

데이터(친구, 클리어 기록)를 저장할 곳이에요. Vercel 서버는 요청마다 꺼졌다 켜져서 파일에 저장할 수 없어요.

1. <https://upstash.com> 에 가입하고 Redis 데이터베이스를 새로 만들어요.
2. 리전(지역)은 Vercel 함수 리전과 가까운 곳이 좋아요. 잘 모르겠으면 가까운 아시아나 미국 동부 중 하나를 고르세요.
3. 만든 데이터베이스 화면의 **REST API** 부분에서 두 값을 복사해요.
   - REST URL → `UPSTASH_REDIS_REST_URL`
   - REST TOKEN → `UPSTASH_REDIS_REST_TOKEN`

Vercel의 **Storage / Marketplace** 메뉴에서 Upstash를 연결하면 이름이 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 으로 자동으로 들어가기도 해요. 이 앱은 두 이름을 모두 알아들어요(`UPSTASH_REDIS_REST_*` 가 있으면 그것을 먼저 써요). URL과 토큰은 같은 쌍에서 와야 해요.

배포 환경(Vercel)에서 둘 다 없으면 앱이 데이터를 잃지 않도록 **저장소를 쓰는 모든 요청을 거부하고** "저장소(Upstash Redis) 환경변수가 설정되지 않았어요…" 안내를 보여 줘요. 이 안내가 보이면 환경변수를 넣고 다시 배포하세요.

## 4. Vercel 배포

1. 이 폴더를 GitHub 저장소로 올려요 (또는 `npm i -g vercel` 후 `vercel` 명령으로 바로 배포해도 돼요).
2. <https://vercel.com> 에서 **Add New → Project**로 그 저장소를 가져와요(Import). Next.js는 자동으로 인식돼요.
3. 배포 전에 **Environment Variables**에 아래 값을 넣어요.

| 이름 | 필수 | 용도 |
| --- | --- | --- |
| `LOSTARK_JWT` | 필수 | 1번에서 받은 로스트아크 API 토큰 |
| `DISCORD_PUBLIC_KEY` | 디스코드 사용 시 필수 | 디스코드 요청의 서명을 확인해요. 없으면 모든 디스코드 요청을 거부해요 |
| `DISCORD_APP_ID` | 명령어 등록 시 필수 | 디스코드 앱 ID (명령어 등록 스크립트가 써요) |
| `DISCORD_BOT_TOKEN` | 명령어 등록 시 필수 | 봇 토큰 (명령어 등록 스크립트가 써요) |
| `UPSTASH_REDIS_REST_URL` | 필수 | 저장소 주소 (또는 `KV_REST_API_URL`). 배포 환경에서 없으면 저장소를 쓰는 요청이 503 안내로 거부돼요 |
| `UPSTASH_REDIS_REST_TOKEN` | 필수 | 저장소 토큰 (또는 `KV_REST_API_TOKEN`) |
| `APP_PASSWORD` | 강력 추천 | 웹 화면 비밀번호. 비우면 주소를 아는 누구나 쓸 수 있어요 |
| `CRON_SECRET` | 필수 | 주간 자동 작업 인증. 비우면 크론이 거부돼요 |

`APP_PASSWORD`는 친구들과 공유할 쉬운 비밀번호를 정하면 돼요. `CRON_SECRET`은 추측할 수 없는 긴 문자열이어야 해요. PC 터미널에서 이렇게 만들 수 있어요.

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

4. **Deploy**를 눌러요. 끝나면 `https://<프로젝트>.vercel.app` 같은 주소가 생겨요.

이 저장소의 `vercel.json`이 매주 수요일 06:00(KST) = 화요일 21:00(UTC)에 `/api/cron/weekly`를 부르도록 설정해 둬요. 이 작업은 지난주 클리어 기록을 지우고 친구들의 원정대 정보를 새로 불러와요(수동 입력한 전투력과 디스코드 연결은 유지돼요). Vercel은 `CRON_SECRET`이 있으면 자동으로 인증 헤더를 붙여 줘요.

## 5. 디스코드에 주소 연결

1. 디스코드 개발자 포털 → 내 앱 → **General Information**의 **Interactions Endpoint URL**에 `https://<도메인>/api/discord` 를 넣고 저장해요.
2. 저장하는 순간 디스코드가 확인용 PING을 보내요. 우리 서버가 서명을 확인하고 응답하면 저장이 성공해요.
3. 실패하면:
   - Vercel 환경변수에 `DISCORD_PUBLIC_KEY`가 정확히 들어갔는지(복사할 때 공백이 섞이지 않았는지) 확인해요.
   - 환경변수를 추가/수정했다면 Vercel에서 **다시 배포(Redeploy)** 해야 적용돼요.
   - 주소 끝에 `/api/discord`를 정확히 썼는지 확인해요.

## 6. 명령어 등록

PC에서 한 번만 하면 돼요(명령어 목록을 바꿨을 때 다시 실행). 프로젝트 폴더에 `.env.local` 파일을 만들고(`.env.example`을 복사하세요) `DISCORD_APP_ID`와 `DISCORD_BOT_TOKEN`을 채운 뒤:

```
npm install
npm run register-commands
```

`등록 성공`이 나오면 디스코드에서 `/`를 눌렀을 때 명령어가 보여요. 전체 반영에 잠시 걸릴 수 있어요.

## 7. 첫 사용

**웹**: 배포 주소를 열고 `APP_PASSWORD`를 입력해요. 친구를 추가할 때 표시 이름과 대표 캐릭터 이름을 넣으면 원정대가 자동으로 불러와져요.

**디스코드**: 각자 아래 명령어를 써요.

- `/명령어` : 사용법 보기
- `/등록 대표캐릭터:<이름>` : 내 원정대 등록/갱신
- `/공대 레이드:<레이드>` : 이번 주 안 간 캐릭터로 공대 후보 짜기
- `/클리어` : 내 캐릭터의 이번 주 클리어 표시
- `/현황` : 이번 주 전체 클리어 현황

처음에는 `/명령어` → `/등록` → `/공대` → `/클리어` 순서로 눌러 보며 응답이 오는지 확인하세요. 웹에서도 같은 친구가 보이면 성공이에요.

## 8. 로컬에서 개발하기

```
npm install
```

`.env.local` 예시 (실제 값으로 바꾸세요. 이 파일은 git에 올라가지 않아요):

```
LOSTARK_JWT=여기에_로스트아크_JWT
DISCORD_PUBLIC_KEY=여기에_Public_Key
DISCORD_APP_ID=여기에_Application_ID
DISCORD_BOT_TOKEN=여기에_Bot_Token
UPSTASH_REDIS_REST_URL=https://example.upstash.io
UPSTASH_REDIS_REST_TOKEN=여기에_REST_TOKEN
APP_PASSWORD=원하는_비밀번호
CRON_SECRET=긴_무작위_문자열
```

```
npm run dev     # http://localhost:3000
npm test        # 자동 테스트 (인터넷 불필요)
```

Upstash 값을 비우면 `npm run dev`(로컬 개발)와 테스트에서는 임시 메모리 저장소를 써서 서버를 끄면 데이터가 사라져요. 로컬 확인용으로는 충분해요. `npm run build && npm start`처럼 프로덕션 모드로 실행하거나 Vercel에 배포하면 메모리 저장소로 넘어가지 않고 설정 안내 오류를 내요.

## 9. 문제 해결

- **Interactions Endpoint URL 저장 실패 / 서명 오류(401)**: `DISCORD_PUBLIC_KEY` 값이 앱의 Public Key와 같은지, 환경변수 수정 후 재배포했는지 확인해요.
- **"요청이 너무 많아요" (429)**: 로스트아크 API는 분당 요청 수 제한이 있어요(약 100회로 알려져 있어요). 1분 정도 기다린 뒤 다시 시도하세요. 원정대 한 번 등록에 캐릭터 수만큼 요청이 들어가요.
- **"캐릭터를 찾을 수 없어요"**: 대표 캐릭터 이름의 오타를 확인하세요. 캐릭터가 이름을 바꿨거나, 최근 접속하지 않은 경우에도 그럴 수 있어요.
- **"로스트아크 API 토큰이 올바르지 않아요"**: `LOSTARK_JWT`를 다시 복사해 넣고 재배포하세요.
- **전투력이 비어 있어요**: API가 전투력을 주지 않는 캐릭터가 있어요. 웹 화면에서 그 캐릭터의 전투력을 직접 입력하면 돼요. 입력한 값은 주간 갱신 뒤에도 유지돼요.
- **크론이 안 돌아요**: Vercel 프로젝트의 **Settings → Cron Jobs**(메뉴 이름은 바뀔 수 있어요)에서 등록 여부를 확인하세요. `CRON_SECRET` 환경변수가 없거나 다르면 `401`이 나와요. 크론은 배포된 프로덕션에서만 돌아요. 무료 플랜은 하루 1회 단위만 지원하는데, 이 설정은 주 1회라 괜찮아요. 크론이 실패해도 클리어 기록은 주차별로 따로 저장되기 때문에 새 주 기록은 자동으로 비어 시작해요.

## 10. 로아 API 확인 안내 (처음 한 번 꼭 해 주세요)

`src/lostark/client.ts`는 공개된 문서 형태를 바탕으로 쓴 것이고, **실제 토큰으로 응답 모양을 확인하지 못했어요.** 처음에 한 번 이렇게 확인하세요.

1. `.env.local`에 `LOSTARK_JWT`를 넣어요.
2. 실행해요. 토큰은 출력되지 않아요.

```
npx tsx scripts/probe-lostark.ts <대표캐릭터>
```

3. 출력된 필드(원정대 필드, 전투력 값, 각인/아크패시브 정보)를 `tests/lostark/fixtures` 안의 파일들과 비교해요.
4. 다르면 fixtures와 `client.ts`의 파싱을, 그리고 서포터 판별 기준인 `SUPPORT_CLASSES`(`src/core/raids.ts`)를 실제 응답에 맞게 고치고 `npm test`로 확인하세요.
