# UI sound effects

The five sound effects use deterministic local modal synthesis.
They do not use Fish Audio generation, external samples, or API calls.
All files are mono 48 kHz, signed 16-bit PCM WAV, with silence at both ends.

| Event        | Selected candidate | File            |
| ------------ | ------------------ | --------------- |
| Daemon ready | Startup B          | `start-b.wav`   |
| Hover        | Hover B            | `hover-b.wav`   |
| Click        | Click B            | `click-b.wav`   |
| Success      | Success A          | `success-a.wav` |
| Error        | Error A            | `error-a.wav`   |

Run `bun scripts/sounds.ts` from `apps/desktop` to regenerate the WAV files and bundled sound data.
`scripts/sound-recipes.ts` defines the selected synthesis settings, and `scripts/sound-synthesis.ts` implements PCM synthesis.
