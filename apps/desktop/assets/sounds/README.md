# UI sounds

These five original clips use deterministic local modal synthesis.
They do not use Fish Audio generation, external samples, or API calls.
All files are mono 48 kHz, signed 16-bit PCM WAV with silent endpoints.

| Event        | Selected candidate | File            |
| ------------ | ------------------ | --------------- |
| Daemon ready | Start B            | `start-b.wav`   |
| Hover        | Hover B            | `hover-b.wav`   |
| Click        | Click B            | `click-b.wav`   |
| Completion   | Success A          | `success-a.wav` |
| Error        | Error A            | `error-a.wav`   |

Run `bun scripts/sounds.ts` from `apps/desktop` to regenerate the WAVs and embedded sound bank.
`scripts/sound-recipes.ts` owns the chosen recipes, and `scripts/sound-synthesis.ts` owns PCM synthesis.
