# Test fixtures

All fixtures are synthetic. They contain no real names, ISU numbers or other personal data.

- Files without a `-live` origin below come from the MIT-licensed
  [my-itmo-api](https://github.com/alllexey-dev/my-itmo-api) KMP fixtures
  (`kmp/fixtures/<area>/<case>.json`, commit `9bac3ed`).
- These files were captured from the live services and passed through
  `scripts/sanitize-fixture.ts`, which keeps only the response shape:
  - `my-itmo/recordbook/specializations.json`
  - `my-itmo/finances/income.json`
  - `my-itmo/dormitory/{status,periods,contracts}.json`
  - `my-itmo/booking/my.json`
  - `my-itmo/queues/archive.json`
  - `my-itmo/sport/competitions.json`
  - `my-itmo/election/availability.json`
  - `bars/groups-live.json`

Never commit raw captures. Run new ones through the sanitizer first.
