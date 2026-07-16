# Parity ledger

| # | Design requirement | Required action | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Popup is 420×600 | fixed popup shell | `popup.png`; 420×600 DOM metrics | PASS |
| 2 | Original radar icon, not OpenAI mark | code-native SVG/CSS mark | icon files and screenshot | PASS |
| 3 | Signal module is first working area | render before quota | browser accessibility snapshot | PASS |
| 4 | High/neutral confidence state | bind signal assessment | rendered high-confidence screenshot | PASS |
| 5 | Evidence control opens source | real background action | browser click emitted `OPEN_EVIDENCE` | PASS |
| 6 | 5-hour meter | normalize duration 18000 | unit test + `.quota-row` | PASS |
| 7 | Weekly meter | normalize duration 604800 | unit test + `.quota-row` | PASS |
| 8 | Reset time uses user time zone | UTC storage + Intl display | time-zone tests | PASS |
| 9 | Banked reset count and nearest expiry | tolerant credit decoder | usage tests | PASS |
| 10 | Advice prioritizes blocked state | port Watcher rules | advice tests | PASS |
| 11 | Official signal can override hold advice | merge signal and quota rules | advice tests | PASS |
| 12 | Refresh button is functional | content capture then fallback | browser click emitted `REFRESH_NOW` | PASS |
| 13 | Four settings navigation items | create fixed rail | browser snapshot + structural check | PASS |
| 14 | Monitor toggles | persist settings | settings save path + structural check | PASS |
| 15 | Confidence segmented control | persist threshold | browser changed and saved `medium` | PASS |
| 16 | System/manual IANA time zone | validate override | interaction + unit tests | PASS |
| 17 | Three notification toggles | persist settings | browser changed and saved toggle state | PASS |
| 18 | Overnight quiet hours | time-zone-aware calculation | unit test | PASS |
| 19 | Privacy section names exact sources | create source rows | desktop/mobile screenshots | PASS |
| 20 | Clear local data is real | preserve settings, clear snapshots | browser confirmed only settings remained | PASS |
| 21 | Native notification has real actions | buttons and handlers | structural check for actions and handlers | PASS |
| 22 | No horizontal overflow | responsive CSS | 390px and 420px DOM metrics | PASS |
| 23 | No fake production data | explicit unavailable states | screenshot and code check | PASS |
| 24 | No automatic redemption | no mutation endpoint | source scan | PASS |
