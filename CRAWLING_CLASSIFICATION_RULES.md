# 수집 및 분류 규칙

## 목적

발레매니아 채용공고를 시작으로 여러 구인 사이트의 공고를 같은 JSON 구조로 수집·분류한다.

핵심 원칙은 다음과 같다.

- 원문 데이터는 `raw`에 최대한 보존한다.
- 자동 분류 결과는 `classification`에 분리한다.
- 분류 근거는 `classification.evidence`에 남긴다.
- 값이 불명확하면 억지로 확정하지 않고 `unknown`, `null`, 빈 배열을 사용한다.

## 기본 JSON 구조

```json
{
  "source": "balletmania",
  "sourcePostId": "86868",
  "url": "https://www.balletmania.com/work/employ_detail.html?no=86868",
  "collectedAt": "2026-06-11T15:00:00.000Z",
  "raw": {
    "title": "(강남) 성인취미발레 평일 저녁",
    "company": "리클래시 발레 스튜디오",
    "companyType": "무용학원",
    "postedDate": "2026-06-11",
    "closingDateText": "채용시",
    "summaryMajorText": "발레",
    "summaryRegionText": "서울 강남구",
    "summaryPayText": "3만원~4만원 미만",
    "detailText": "학원명(지역) ▶ 강남 개포동역..."
  },
  "classification": {
    "isBallet": true,
    "balletConfidence": "high",
    "dropReason": null,
    "jobType": "regular",
    "audiences": ["adult"],
    "subjects": ["ballet"],
    "locations": [
      {
        "sido": "서울",
        "sigungu": "강남구",
        "dongOrStation": "개포동역",
        "raw": "강남 개포동역"
      }
    ],
    "schedule": {
      "days": ["금"],
      "dayRaw": "금요일",
      "timeSlots": ["evening"],
      "times": [
        {
          "start": "19:30",
          "end": "20:30",
          "raw": "금 19:30~20:30"
        }
      ],
      "classCount": 1,
      "durationMinutes": 60,
      "startDate": null
    },
    "pay": {
      "type": "hourly",
      "minManwon": 3,
      "maxManwon": 4,
      "amountText": "3만원~4만원 미만",
      "isNegotiable": true,
      "deductions": []
    },
    "requirements": {
      "majorRequired": true,
      "experienceRequired": null,
      "certifications": [],
      "preferred": []
    },
    "contact": {
      "emails": ["leeclassy.ballet@gmail.com"],
      "phones": ["010-7508-7917"],
      "applyMethods": ["email", "sms"]
    },
    "dedupe": {
      "entityKey": "리클래시 발레 스튜디오|서울|강남구",
      "sameCompanyCandidates": []
    },
    "evidence": {
      "audiences": ["성인반", "성인취미발레"],
      "days": ["금요일", "금 19:30~20:30"],
      "pay": ["시간 당 페이 3만원~4만원 미만", "희망시급 기재"]
    }
  }
}
```

## `raw` 필드 규칙

`raw`는 사이트에서 가져온 값을 정규화 전 상태로 보존한다.

| 필드 | 설명 |
| :--- | :--- |
| `title` | 상세 페이지 제목 또는 목록 제목 |
| `company` | 회사·학원명 |
| `companyType` | 사이트가 제공하는 업체 유형. 예: `무용학원`, `파견회사` |
| `postedDate` | 등록일. 가능하면 `YYYY-MM-DD` |
| `closingDateText` | 마감일 원문. 예: `채용시`, `상시채용`, `~06.20` |
| `summaryMajorText` | 사이트 요약표의 모집 전공 분야 원문 |
| `summaryRegionText` | 사이트 요약표의 근무 지역 원문 |
| `summaryPayText` | 사이트 요약표의 시간 당 페이 원문 |
| `detailText` | 상세모집내용 전체 텍스트 |

발레매니아는 로그인 후 상세 페이지의 `#employ_detail_textarea` 값에서 `detailText`를 가져온다.

## 분류 필드 규칙

### 발레 여부

| 필드 | 값 |
| :--- | :--- |
| `isBallet` | 발레 관련 공고면 `true`, 명확히 아니면 `false` |
| `balletConfidence` | `high`, `medium`, `low` |
| `dropReason` | 드랍 사유. 통과면 `null` |

발레 여부는 `summaryMajorText`, `title`, `detailText` 순서로 판단한다.

드랍 예시:

- 현대무용만 모집
- 한국무용만 모집
- K-pop, 방송댄스, 힙합만 모집
- 필라테스만 모집

단, 발레와 다른 과목이 함께 있으면 드랍하지 않고 `subjects` 배열에 모두 기록한다.

### 공고 유형

`jobType` 값:

- `regular`: 정규 채용, 장기 수업, 고정 요일 수업
- `substitute`: 대타, 대강, 일일 대체 수업
- `one_time`: 단기·이벤트성 수업
- `unknown`: 판단 불가

판단 키워드:

- `substitute`: `대타`, `대강`, `하루`, `당일`, `이번주`
- `regular`: `정식`, `오래`, `장기`, `고정`, `월~금`, `매주`, `함께 일하실`

### 수업 대상

`audiences`는 배열이다.

값:

- `toddler`: 영유아, 유치원, 어린이집, 5~7세
- `child`: 유아·초등을 넓게 포함하는 아동
- `elementary`: 초등
- `teen`: 중고등, 청소년
- `adult`: 성인, 성인취미, 직장인
- `exam`: 입시, 전공 입시
- `mixed`: 여러 대상이 섞여 있으나 세부 분리가 어려움
- `unknown`: 판단 불가

여러 대상이 명확하면 `["toddler", "adult"]`처럼 복수로 넣는다.

### 수업 과목

`subjects`는 배열이다.

값:

- `ballet`
- `barre`
- `ballet_fit`
- `kpop_dance`
- `modern_dance`
- `korean_dance`
- `pilates`
- `other`

발레 외 과목이 같이 있으면 함께 기록한다.

예: `대치동 5~7세 댄스, 발레`는 `["kpop_dance", "ballet"]`.

### 지역

`locations`는 배열이다.

```json
{
  "sido": "서울",
  "sigungu": "강남구",
  "dongOrStation": "개포동역",
  "raw": "강남 개포동역"
}
```

규칙:

- 사이트 요약표의 `summaryRegionText`를 1차 기준으로 사용한다.
- 상세본문에 더 구체적인 동, 역, 건물명이 있으면 `dongOrStation` 또는 `raw`에 보강한다.
- 여러 지역이 나오면 배열로 모두 저장한다.
- `전지역`은 `sigungu`에 그대로 넣거나, 추후 표준 지역 코드 도입 시 별도 코드로 분리한다.

### 스케줄

```json
{
  "days": ["월", "수", "금"],
  "dayRaw": "월 수 금",
  "timeSlots": ["morning", "evening"],
  "times": [
    {
      "start": "10:00",
      "end": "11:00",
      "raw": "오전10시~11시"
    }
  ],
  "classCount": 3,
  "durationMinutes": 60,
  "startDate": "2026-07-01"
}
```

요일 값:

- `월`, `화`, `수`, `목`, `금`, `토`, `일`

`timeSlots` 값:

- `morning`: 오전, 05:00~11:59
- `afternoon`: 오후, 12:00~17:59
- `evening`: 저녁, 18:00~23:59
- `negotiable`: 협의
- `unknown`: 판단 불가

규칙:

- `화목`, `월수금`, `월~금` 같은 축약 표현을 분해한다.
- 시간이 여러 개면 `times` 배열에 모두 넣는다.
- “2타임”, “3Class”, “1타임”은 `classCount`에 넣는다.
- “60분”, “45분씩”은 `durationMinutes`에 넣는다.
- “7월부터”, “9월 시작”은 가능하면 `startDate` 또는 원문 근거에 남긴다. 연도가 불명확하면 `null`로 두고 evidence에 기록한다.

### 급여

```json
{
  "type": "hourly",
  "minManwon": 3,
  "maxManwon": 4,
  "amountText": "3만원~4만원 미만",
  "isNegotiable": true,
  "deductions": []
}
```

`pay.type` 값:

- `hourly`: 시급
- `per_class`: 회당·타임당
- `per_session_bundle`: N회 기준 총액
- `monthly`: 월급
- `negotiable`: 추후 협의
- `unknown`: 판단 불가

규칙:

- `3.5~4만원`은 `minManwon: 3.5`, `maxManwon: 4`.
- `4회 기준 16만`은 `type: per_session_bundle`, `minManwon: 16`, `classCount: 4` 또는 evidence에 기록한다.
- `추후 협의`, `협의가능`은 `isNegotiable: true`.
- `3.3%`, `산재보험료 0.3%`, `총3.6% 차감`은 `deductions`에 기록한다.

### 지원 요건

```json
{
  "majorRequired": true,
  "experienceRequired": null,
  "certifications": ["필라테스"],
  "preferred": ["성인 취미반 티칭 경험", "스피커 지참"]
}
```

규칙:

- `발레전공 필수`, `발레 전공자`는 `majorRequired: true`.
- `경력무관`은 `experienceRequired: false`.
- `티칭경험`, `유치원/어린이집 경험`은 `preferred`에 넣는다.
- `자격증 소지자`, `스피커 지참 필수`, `튜튜 착용 필수`처럼 운영상 조건도 보존한다.

### 연락처

```json
{
  "emails": ["example@email.com"],
  "phones": ["010-1234-5678"],
  "applyMethods": ["email", "sms"]
}
```

`applyMethods` 값:

- `email`
- `sms`
- `phone`
- `online`
- `kakao`
- `unknown`

규칙:

- 본문에서 이메일과 전화번호를 정규식으로 추출한다.
- `문자 남겨주세요`는 `sms`.
- `이메일로 이력서`는 `email`.
- 사이트 온라인 접수 버튼은 `online`.

### 중복 판별

```json
{
  "entityKey": "엘발레스튜디오|경기|수원시 영통구",
  "sameCompanyCandidates": ["86865"]
}
```

규칙:

- 1차 키: `company + sido + sigungu`
- 2차 키: 전화번호 또는 이메일 동일 여부
- 제목과 본문이 거의 같으면 같은 공고 후보로 본다.
- 지역만 다르고 본문이 같은 경우에는 같은 회사의 다지역 공고로 볼 수 있으므로 바로 병합하지 않고 후보로 둔다.

## 2026-06-11 샘플에서 확인한 케이스

| 공고 번호 | 케이스 | 규칙 |
| :--- | :--- | :--- |
| `86864` | 발레와 K-pop 댄스가 함께 있음 | `subjects` 배열에 복수 기록 |
| `86858` | 여러 지역과 4회 기준 급여 | `locations` 배열, `pay.type=per_session_bundle` |
| `86861` | 여러 요일·시간대 | `schedule.times` 배열 |
| `86856` | 4회 기준 16만, 공제율 있음 | `deductions` 기록 |
| `86860` | 바레·발레핏 가능자 우대 | `subjects`, `requirements.certifications` 기록 |
| `86866`, `86865` | 같은 본문, 다른 지역 요약 | `dedupe.sameCompanyCandidates` 후보 |

## 구현 우선순위

1. 상세 페이지 로그인 세션 확보
2. 목록 JSON의 각 `url` 방문
3. `raw.detailText`를 `#employ_detail_textarea`에서 추출
4. 요약표에서 전공·지역·페이 추출
5. 이메일·전화번호 정규식 추출
6. 룰 기반으로 `subjects`, `audiences`, `schedule`, `pay` 분류
7. 애매한 항목만 LLM fallback 적용
8. 결과 JSON에 `evidence` 저장
