# Frontend Skill

웹페이지·제품 UI·보고서의 시각적 위계와 개성을 설계하는 경량 스킬 초안입니다. 요청한 변경 규모에 맞춰 작업하고, 내용·브랜드·동작을 보존하면서 읽기와 조작을 개선하도록 구성했습니다.

Codex와 Claude Code는 표준 스킬 폴더를 사용합니다. Mixdog용 ZIP에는 같은 지침과 참조 문서에 Mixdog의 선택 문구를 추가했습니다. 호스트별 자동 선택률, 생성 품질, 시간·토큰 절감 효과는 아직 비교 검증하지 않았습니다.

## 적용 범위

- 새 페이지와 화면의 정보 구조·시각 방향 설계
- 기존 UI의 부분 개선 또는 전면 리디자인
- 레이아웃·타이포그래피·색·상태·시각자료 검토
- 데이터 화면과 장문 보고서의 읽기·비교 개선

검토 요청에는 파일 변경 없이 근거와 제안을 제공합니다. 수정 요청은 허용된 범위만 구현합니다. 백엔드 로직·자료 조회·시각과 무관한 유지보수만 요청하면 디자인 절차를 적용하지 않습니다.

## 구성

스킬 본문과 참조 문서의 원본은 [`skills/frontend-skill/`](skills/frontend-skill/)에 있습니다.

| 파일 | 역할 |
| --- | --- |
| [SKILL.md](skills/frontend-skill/SKILL.md) | 작업 범위, 표현 방향, 공통 디자인 판단, 필요한 참조 선택, 검증과 종료 |
| [web-pages.md](skills/frontend-skill/references/web-pages.md) | 소개·홍보·안내 페이지의 읽기 순서, 실제 자료, 다음 행동 |
| [product-ui.md](skills/frontend-skill/references/product-ui.md) | 탐색·입력·작업 밀도·상태·오류·복구 |
| [data-and-reading.md](skills/frontend-skill/references/data-and-reading.md) | 수치·비교·차트·출처·긴 읽기 흐름과 요청된 출력 |
| [agents/openai.yaml](skills/frontend-skill/agents/openai.yaml) | Codex용 표시 이름·짧은 설명·호출 예시 |

참조는 변경하는 정보나 동작에 따라 선택합니다. 예를 들어 홍보 페이지의 차트를 수정하면 수치·비교 부분도 확인하고, 보고서의 필터를 수정하면 조작·상태 부분도 확인합니다. 단순한 간격 수정에 세 문서를 전부 읽도록 요구하지 않습니다.

README와 [평가 사례](docs/evaluation.md)는 저장소 이용자를 위한 문서이며, 스킬의 필수 읽기 목록에 들어가지 않습니다.

## 설치와 호출

**Codex와 Claude Code**는 저장소에서 [표준 스킬 폴더](skills/frontend-skill/) 전체를 복사하세요. **Mixdog**는 [Mixdog 설치 ZIP](packages/frontend-skill-mixdog.zip?raw=true)을 받아 데이터 폴더의 `skills/` 안에 압축을 푸세요. ZIP 안에 이미 `frontend-skill/` 폴더가 있습니다.

상위 `skills` 폴더가 없으면 만드세요. `~`는 사용자 홈, `<프로젝트>`는 사용할 프로젝트, `<Mixdog 데이터 폴더>`는 사용 중인 Mixdog의 데이터 위치입니다.

| 호스트 | 설치할 폴더 (범위 하나만 선택) | 새 세션에서 확인 |
| --- | --- | --- |
| [Codex CLI / IDE](https://developers.openai.com/codex/skills/) | `<프로젝트>/.agents/skills/frontend-skill/` 또는 `~/.agents/skills/frontend-skill/` | `/skills` 목록에서 찾고, `$frontend-skill 이 화면을 검토해줘`로 호출 |
| [Claude Code](https://code.claude.com/docs/en/skills) | `<프로젝트>/.claude/skills/frontend-skill/` 또는 `~/.claude/skills/frontend-skill/` | `/` 메뉴에서 찾고, `/frontend-skill 이 화면을 검토해줘`로 호출 |
| Mixdog | `<Mixdog 데이터 폴더>/skills/frontend-skill/` (사용자 전체, 기본값은 `~/.mixdog/data/skills/frontend-skill/`) | 새 대화에서 `$frontend-skill 이 화면을 검토해줘`로 호출하고 스킬 로드 기록 확인 |

복사한 경로 바로 아래에 `SKILL.md`, `references/`, `agents/`가 있어야 합니다. 기존 동명 스킬이 있으면 덮어쓰기 전에 내용을 비교하세요. 저장소를 복제하는 것만으로 각 호스트에 설치되지는 않습니다. 별도 플러그인이나 패키지 설치는 필요하지 않습니다.

일상적인 요청에는 이름을 붙이지 않아도 됩니다. Codex와 Claude Code는 표준 원본의 `description`으로 스킬을 선택합니다. Mixdog가 모델에 보여 주는 선택 문구는 ZIP의 `SKILL.md` 최상위 `when_to_use`에 들어 있습니다. [Claude Code 필드 설명](https://code.claude.com/docs/en/skills#frontmatter-reference) · [Mixdog 스킬 목록 형식](https://github.com/tribgames/mixdog/blob/8382c929c3d7ae5c6692136c67c63be821838bc0/src/defaults/skills/skill-creator/references/design.md#listing-line)

자동 선택 여부는 이름을 생략한 요청으로 확인합니다. 아래 예시는 세 호스트에서 모두 사용할 수 있습니다.

```text
이 화면의 표와 검색 영역을 다듬어줘.
브랜드와 데이터, 기존 검색 동작은 유지하고 좁은 화면에서도 읽기 쉽게 해줘.
```

```text
자료를 토대로 새 소개 페이지를 만들어줘.
독자는 처음 방문한 사람이고, 서비스 범위와 신청 방법을 쉽게 파악해야 해.
```

```text
이 보고서의 디자인을 검토해줘. 파일 수정은 하지 마.
수치·단위·출처가 잘 읽히는지와 정보 위계를 중심으로 봐줘.
```

## 설계 원칙

**변경량을 목적에 맞춥니다.** 작은 요청을 전체 재설계로 확대하지 않고, 전면 리디자인에서는 정보 구조도 검토합니다. 유효한 기존 디자인을 유지하는 선택을 허용합니다.

**개성을 실제 소재에서 만듭니다.** 자료의 대상·과정·언어·관계에서 표현의 근거를 찾아 조판·구성·시각자료·상호작용으로 연결합니다. 구도 선택이 열려 있으면 무엇이 주인공이 되고 어떻게 읽히는지가 다른 방향을 짧게 비교합니다. 개성을 새로 요청한 작업에서는 제목·강조색을 넘어 기존 결과와 무엇이 달라졌는지 확인합니다. 소개 페이지는 실제 대상이나 활동이 드러나는 장면을 충분히 보여 주고, 표현을 집중할 부분과 이를 받치는 부분을 정합니다. 비교할 값과 익숙한 조작의 일관성은 유지하며, 작은 수정에 새 정체성이나 여러 완성 시안을 요구하지 않습니다.

**내용과 동작을 보호합니다.** 가상 예시는 식별할 수 있게 하고, 실제 수치·조건·브랜드·기능을 외형 정리를 위해 임의로 바꾸지 않습니다. 한국어를 포함한 실제 문자 체계와 긴 내용으로 조판을 확인합니다.

**검증을 변경한 결과에 연결합니다.** 레이아웃에는 재배치와 긴 내용, 조작에는 키보드와 관련 상태, 데이터에는 의미와 비교 조건을 확인합니다. 미실행 검사를 통과로 보고하지 않습니다.

**도구는 프로젝트에 맞춥니다.** 스킬 자체에 실행 스크립트, 자산 묶음, 종료 훅, 의무 패키지 설치를 두지 않았습니다. 실제 작업에 필요한 브라우저·검사 도구·프로젝트 의존성은 해당 환경과 요청에 맞춰 사용합니다.

## 동작 평가

[평가 사례](docs/evaluation.md)에는 기존 UI의 부분 수정과 검토, 백엔드 작업의 범위 구분, 새 페이지 설계, 보고서 리디자인을 시험할 수 있는 입력과 판정 기준이 있습니다. 수리공방에서는 방문자가 예약 방법을 찾고 신청할 수 있는지 로컬 스텁으로 확인합니다. 도서관 보고서에서는 두 분관의 수치를 비교하고, 선택한 분관의 인쇄물에서도 집계 조건과 출처를 읽을 수 있는지 확인합니다. 사례마다 해당 자료를 임시 폴더에 복사해 실행하세요.

특정 호스트에서 자동으로 선택되는지, 실제 화면과 상호작용이 올바른지, 다른 지침보다 결과가 좋은지는 별도 실행으로 확인해야 합니다. 문서가 짧다는 사실만으로 비용 절감이나 품질 향상을 주장하지 않습니다.

## 참고 배경과 작성 방식

설계 검토에서는 [taste-skill](https://github.com/Leonxlnx/taste-skill/tree/d1a2bb41d927083ac7118f60cfc9cdf711810ea0)과 [unslop](https://github.com/heydamir/unslop/tree/620163eedb3529d9cd23a3994ed8d287d06f760d)의 접근을 비교했습니다. 이 저장소의 지침과 예시는 새로 작성했으며, 해당 프로젝트의 문장·코드·스타터·이미지·검사기를 가져오지 않았습니다. 참고 프로젝트를 실행하거나 설치할 필요도 없습니다.

초안에는 별도 배포 라이선스를 지정하지 않았습니다.
