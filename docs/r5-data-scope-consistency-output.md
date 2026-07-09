# R5 Data Scope Consistency Output

Generated at: 2026-07-09T11:06:11.009Z
Base URL: http://127.0.0.1:3000

This script is read-only. It calls local HTTP APIs and writes this Markdown report only.

| Case | Date range | Store | Audience store orders | Countries summary orders | Countries row orders | Store page orders | Product orders | Audience vs countries | Countries summary vs rows | Store vs audience | Product vs store | API status |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| default | 2026-07-09 ~ 2026-07-09 | all | 0 | 0 | 0 | 0 | 0 | N/A | PASS | N/A | N/A | audience FETCH_ERROR<br>countries FETCH_ERROR<br>stores FETCH_ERROR<br>products FETCH_ERROR<br>creatives FETCH_ERROR |

## Notes

- `N/A` means at least one compared side was zero or unavailable, so the script does not assert consistency.
- API failures are reported as status values and must be re-run during the unified verification pass.
- Creative metrics are called for scope coverage; creative purchases are Meta purchases and are not compared to store orders.
