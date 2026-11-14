# Countries

Multiplayer race to name the most countries before the clock runs out.

## Install on Android

1. Copy `Countries.apk` to your phone.
2. Open it and allow "install unknown apps" for your file manager when asked.
3. Every player installs the same APK. Android 7.0 or newer. Internet required.

## Play

1. One player taps **Create a room** and shares the 5-letter code.
2. Others enter the code and tap **Join**.
3. The host picks the rules and taps **Start**. One player alone can play solo.
4. Type a country, press Go or the keyboard's send key.
5. When time ends, everyone sees the scoreboard. Tap a player to see their answers.

## Rules the host can set

| Rule | Options |
|---|---|
| Time | 1 to 10 minutes |
| World map | Show or hide |
| Show mistakes | During game (flagged at once), or After game (blind round: nothing is marked, the map stays blank, all revealed at the end) |
| Wrong answer costs | Nothing, or −1 point |
| Spelling | Forgive typos, or Exact only |
| Others' scores in game | Hide or show |

Highest score wins. On equal scores, whoever reached that score first wins.

## How answers are judged

- 197 countries: 193 UN members, Vatican City, Palestine, Kosovo and Taiwan.
- Case, accents, spaces and punctuation are ignored.
- Common names work: USA, UK, Holland, Burma, Ivory Coast, DRC, Czech Republic and others.
- Typo tolerance grows with word length. A real country's exact name is never changed into another (Niger stays Niger, Iran stays Iran).
- If a typo could be two countries, or you type "Korea", the game asks which one and charges nothing.
- "Congo" counts for the Republic of the Congo first, then DR Congo.
- Repeating a country costs nothing. Repeating the same wrong answer only counts once.

## How multiplayer works

There is no game server to run. Phones exchange small messages through free public MQTT relays (EMQX, HiveMQ, Mosquitto). The room code records which relay the room uses, and a new room moves to the next relay if one is down.

- Public relays have no uptime promise and no privacy. Only player names, room rules and typed answers are sent. Don't use a name you want kept private.
- If the host leaves, the next player to have joined becomes host.
- A phone that drops out mid-game reconnects and keeps its answers. Results update when it reports back.

## Project layout

- `Countries.apk`: ready-to-install app.
- `web/`: the game (plain HTML, CSS, JavaScript). Also runs from any web server.
- `android/`: minimal WebView wrapper.
- `tools/`: regenerates `web/data.js`, spelling tests.

## Rebuild

Requires JDK 17 or newer and the Android SDK (platform 34).

```bash
cd android
./gradlew assembleRelease
```

Set `sdk.dir` in `android/local.properties`, or set `ANDROID_HOME`. Output: `android/app/build/outputs/apk/release/app-release.apk`. The build signs with your machine's debug key, which is fine for sideloading but not for the Play Store.

Spelling tests and data regeneration:

```bash
cd tools
npm install
node gen-data.js
node test-match.js
```

## Credits

- Country names and locations: [mledoze/countries](https://github.com/mledoze/countries), Open Database License (ODbL).
- Map shapes: [Natural Earth](https://www.naturalearthdata.com/) via world-atlas, public domain.
- MQTT client: [MQTT.js](https://github.com/mqttjs/MQTT.js), MIT.
